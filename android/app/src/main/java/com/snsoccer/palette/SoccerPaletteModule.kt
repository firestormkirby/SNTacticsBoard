package com.snsoccer.palette

import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.RectF
import android.net.Uri
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap

/**
 * The floating palette, as a React Native module ("SoccerPalette").
 *
 * Three system overlay windows (TYPE_APPLICATION_OVERLAY), which stay on
 * screen after the plugin panel closes, so the palette sits over the note
 * while the user writes:
 *
 *  - the palette strip itself (PaletteView), small and always there;
 *  - a ghost piece that follows the finger while a piece is dragged out;
 *  - in move mode, a full-screen layer for dragging pieces already on the
 *    page (MoveLayerView).
 *
 * The windows only handle touch and drawing. Every change to the note is made
 * by JS (src/palette/controller.ts), which receives one event stream,
 * "SoccerPalette", whose `type` says what happened.
 *
 * The pen draws, the finger moves. A pen on any overlay still writes into the
 * note underneath, because pen input reaches the Note app by a hardware path
 * no window can intercept (skill notes, gotcha 31). Fingers never write, so
 * finger drags need no pen lock at all. Events carry the tool type so JS can
 * tell the user when a pen was used.
 *
 * The overlay permission belongs to the plugin host's package
 * (com.ratta.supernote.pluginhost); `requestOverlayPermission` opens the
 * system screen for it.
 */
class SoccerPaletteModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx), PaletteView.Listener, MoveLayerView.Listener {

    companion object {
        const val NAME = "SoccerPalette"
        const val EVENT = "SoccerPalette"
        private const val TAG = "SoccerPalette"
    }

    override fun getName(): String = NAME

    private val wm: WindowManager
        get() = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    private var palette: PaletteView? = null
    private var paletteParams: WindowManager.LayoutParams? = null
    private var ghost: GhostView? = null
    private var ghostParams: WindowManager.LayoutParams? = null
    private var moveLayer: MoveLayerView? = null

    /** Piece size in screen pixels, as JS draws it on the page. */
    private var pieceSizePx = 64
    private var side = "right"

    // ── Helpers ─────────────────────────────────────────────────────────────

    private fun screen(): DisplayMetrics {
        val m = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(m)
        return m
    }

    @Suppress("DEPRECATION")
    private fun rotation(): Int = wm.defaultDisplay.rotation

    private fun overlay(w: Int, h: Int, touchable: Boolean): WindowManager.LayoutParams {
        var flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        if (!touchable) flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        return WindowManager.LayoutParams(
            w, h,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            flags,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP or Gravity.START }
    }

    /**
     * emitDeviceEvent rather than getJSModule(...).emit: it is the path that
     * also works in bridgeless mode, where hasActiveReactInstance() can be
     * false even though JS is running.
     */
    private fun emit(type: String, fill: WritableMap.() -> Unit = {}) {
        try {
            val map = Arguments.createMap()
            map.putString("type", type)
            map.fill()
            ctx.emitDeviceEvent(EVENT, map)
        } catch (e: Exception) {
            Log.e(TAG, "emit $type: ${e.message}", e)
        }
    }

    /** Where a touch landed, with what JS needs to map it onto the page. */
    private fun WritableMap.putPoint(rawX: Float, rawY: Float) {
        val s = screen()
        putDouble("x", rawX.toDouble())
        putDouble("y", rawY.toDouble())
        putInt("screenWidth", s.widthPixels)
        putInt("screenHeight", s.heightPixels)
        putInt("rotation", rotation())
    }

    private fun removeQuietly(v: View?) {
        if (v == null) return
        try {
            wm.removeView(v)
        } catch (e: Exception) {
            Log.w(TAG, "removeView: ${e.message}")
        }
    }

    private fun paletteRect(): RectF {
        val p = paletteParams ?: return RectF()
        val v = palette ?: return RectF()
        return RectF(p.x.toFloat(), p.y.toFloat(), (p.x + v.widthPx).toFloat(), (p.y + v.heightPx).toFloat())
    }

    private fun snapX(v: PaletteView, s: DisplayMetrics): Int {
        val margin = (8 * s.density).toInt()
        return if (side == "left") margin else s.widthPixels - v.widthPx - margin
    }

    // ── JS API ──────────────────────────────────────────────────────────────

    @ReactMethod
    fun canDrawOverlays(promise: Promise) {
        promise.resolve(Settings.canDrawOverlays(ctx))
    }

    @ReactMethod
    fun requestOverlayPermission() {
        try {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + ctx.packageName),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "requestOverlayPermission: ${e.message}", e)
        }
    }

    @ReactMethod
    fun getScreenInfo(promise: Promise) {
        val s = screen()
        val map = Arguments.createMap()
        map.putInt("width", s.widthPixels)
        map.putInt("height", s.heightPixels)
        map.putDouble("density", s.density.toDouble())
        map.putInt("rotation", rotation())
        promise.resolve(map)
    }

    /**
     * Show the palette, or move it if it is already showing.
     * options: side ("left" | "right"), y (screen px), pieceSize (screen px).
     * Resolves false without the overlay permission.
     */
    @ReactMethod
    fun show(options: ReadableMap, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                if (!Settings.canDrawOverlays(ctx)) {
                    promise.resolve(false)
                    return@runOnUiThread
                }
                if (options.hasKey("side")) side = options.getString("side") ?: side
                if (options.hasKey("pieceSize")) pieceSizePx = options.getDouble("pieceSize").toInt()
                val s = screen()
                val view = palette ?: PaletteView(ctx, this)
                val params = paletteParams ?: overlay(view.widthPx, view.heightPx, true)
                val wantY = if (options.hasKey("y")) options.getDouble("y").toInt() else (s.heightPixels - view.heightPx) / 2
                params.x = snapX(view, s)
                params.y = wantY.coerceIn(0, maxOf(0, s.heightPixels - view.heightPx))
                if (palette == null) {
                    wm.addView(view, params)
                    palette = view
                    paletteParams = params
                } else {
                    wm.updateViewLayout(view, params)
                }
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "show: ${e.message}", e)
                promise.reject("show_failed", e)
            }
        }
    }

    @ReactMethod
    fun hide() {
        UiThreadUtil.runOnUiThread { hideAll() }
    }

    private fun hideAll() {
        removeQuietly(ghost)
        removeQuietly(moveLayer)
        removeQuietly(palette)
        ghost = null
        ghostParams = null
        moveLayer = null
        palette = null
        paletteParams = null
    }

    @ReactMethod
    fun isShowing(promise: Promise) {
        promise.resolve(palette != null)
    }

    /**
     * Enter or leave move mode. `pieces` is [{id, kind, x, y}] in screen
     * pixels: where the pieces on the current page are drawn.
     */
    @ReactMethod
    fun setMoveMode(enabled: Boolean, pieces: ReadableArray, pieceSize: Double) {
        UiThreadUtil.runOnUiThread {
            try {
                if (!enabled) {
                    removeQuietly(moveLayer)
                    moveLayer = null
                    return@runOnUiThread
                }
                pieceSizePx = pieceSize.toInt()
                val list = (0 until pieces.size()).mapNotNull { i ->
                    val p = pieces.getMap(i) ?: return@mapNotNull null
                    LayerPiece(
                        p.getString("id") ?: return@mapNotNull null,
                        p.getString("kind") ?: return@mapNotNull null,
                        p.getDouble("x").toFloat(),
                        p.getDouble("y").toFloat(),
                    )
                }
                val layer = moveLayer ?: MoveLayerView(ctx, this).also {
                    wm.addView(
                        it,
                        overlay(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, true),
                    )
                    moveLayer = it
                }
                layer.setPieces(list, pieceSizePx.toFloat(), paletteRect())
            } catch (e: Exception) {
                Log.e(TAG, "setMoveMode: ${e.message}", e)
            }
        }
    }

    // Required by NativeEventEmitter on the JS side.
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Double) {}

    override fun invalidate() {
        UiThreadUtil.runOnUiThread { hideAll() }
        super.invalidate()
    }

    // ── Palette events ──────────────────────────────────────────────────────

    override fun onPieceDragStart(kind: String, rawX: Float, rawY: Float) {
        removeQuietly(ghost)
        val size = maxOf(pieceSizePx, 24)
        val g = GhostView(ctx, kind, size)
        val params = overlay(size, size, false)
        params.x = (rawX - size / 2f).toInt()
        params.y = (rawY - size / 2f).toInt()
        try {
            wm.addView(g, params)
            ghost = g
            ghostParams = params
        } catch (e: Exception) {
            Log.w(TAG, "ghost: ${e.message}")
        }
    }

    override fun onPieceDragMove(rawX: Float, rawY: Float) {
        val g = ghost ?: return
        val params = ghostParams ?: return
        params.x = (rawX - g.width / 2f).toInt()
        params.y = (rawY - g.height / 2f).toInt()
        try {
            wm.updateViewLayout(g, params)
        } catch (e: Exception) {
            Log.w(TAG, "ghost move: ${e.message}")
        }
    }

    override fun onPieceDragEnd(kind: String, rawX: Float, rawY: Float, outside: Boolean, toolType: Int) {
        removeQuietly(ghost)
        ghost = null
        ghostParams = null
        if (outside) {
            emit("drop") {
                putString("kind", kind)
                putInt("toolType", toolType)
                putPoint(rawX, rawY)
            }
        } else {
            emit("tapPiece") { putString("kind", kind) }
        }
    }

    override fun onPieceDragCancel() {
        removeQuietly(ghost)
        ghost = null
        ghostParams = null
    }

    override fun onAction(action: String) {
        if (action == PaletteView.ACTION_HIDE) hideAll()
        emit("action") { putString("action", action) }
    }

    override fun onGripDrag(dxRaw: Float, dyRaw: Float) {
        val v = palette ?: return
        val params = paletteParams ?: return
        val s = screen()
        params.x = (params.x + dxRaw).toInt().coerceIn(0, maxOf(0, s.widthPixels - v.widthPx))
        params.y = (params.y + dyRaw).toInt().coerceIn(0, maxOf(0, s.heightPixels - v.heightPx))
        wm.updateViewLayout(v, params)
    }

    override fun onGripRelease() {
        val v = palette ?: return
        val params = paletteParams ?: return
        val s = screen()
        side = if (params.x + v.widthPx / 2 < s.widthPixels / 2) "left" else "right"
        params.x = snapX(v, s)
        wm.updateViewLayout(v, params)
        emit("position") {
            putString("side", side)
            putInt("y", params.y)
        }
    }

    // ── Move layer events ───────────────────────────────────────────────────

    override fun onPieceMoved(id: String, rawX: Float, rawY: Float, toolType: Int) {
        emit("move") {
            putString("id", id)
            putInt("toolType", toolType)
            putPoint(rawX, rawY)
        }
    }

    override fun onPieceRemoved(id: String) {
        emit("remove") { putString("id", id) }
    }

    override fun onDone() {
        removeQuietly(moveLayer)
        moveLayer = null
        emit("action") { putString("action", "moveDone") }
    }
}
