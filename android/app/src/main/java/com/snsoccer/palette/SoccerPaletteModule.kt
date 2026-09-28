package com.snsoccer.palette

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Rect
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import kotlin.math.abs

/**
 * Soccer Board's floating button, palette and piece handles ("SoccerPalette").
 *
 * Every piece of UI here is its own small system overlay window
 * (TYPE_APPLICATION_OVERLAY) with FLAG_NOT_TOUCH_MODAL, the same arrangement
 * as Modulanner's floating button: a window takes the touches that land on it,
 * pen or finger, and every touch anywhere else goes straight to the note. So
 * the pen keeps writing on the page around them.
 *
 *  BUTTON   A round chip. Drag it to move it. Tap it to open or close the
 *           palette. Hold it (0.8 s, still) to open the plugin's menu.
 *  PALETTE  The four pieces in a column beside the button. Drag one out and a
 *           new piece is placed where it is let go.
 *  HANDLES  One invisible window over each piece the note is drawing on the
 *           current page. Drag it and the piece moves; drop it on the button
 *           or the palette and it is removed. No mode to switch on.
 *
 * The windows only handle touch and drawing. Every change to the note is made
 * by JS (src/palette/controller.ts), from one event stream, "SoccerPalette",
 * whose `type` says what happened.
 *
 * PEN
 *           On a Supernote the pen also writes into the note through the
 *           digitizer, whatever window it's over, so a pen drag on these
 *           windows would draw a line. While one lasts, the pen is locked the
 *           way the Supernote plugin notes describe: the host's PluginApp is
 *           put in state 1, which makes the Note app disable the pen
 *           full-screen, and back in state 0 when the drag ends (reflection:
 *           the SDK's own showPluginView has no state argument). JS is told
 *           ("penLock", "penDrag") so it can keep its panel out of the way
 *           and clean up any stroke that got through before the lock landed.
 *
 * Details carried over from Modulanner's PlannerOverlayModule, which adapted
 * them from SuperDashboard by AgP42 (MIT, github.com/AgP42/SuperDashboard):
 * PixelFormat.TRANSLUCENT (an opaque overlay turns round chips into black
 * squares on Manta), SP sizing for the button, a long press that is long on
 * purpose (slow e-ink taps trip a short one), a native tick because PluginHost
 * suspends JS timers while the panel is closed, and a sweep for windows left
 * behind by a previous plugin load.
 */
class SoccerPaletteModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

    companion object {
        const val NAME = "SoccerPalette"
        const val EVENT = "SoccerPalette"
        private const val TAG = "SoccerPalette"
        /** On every window this module adds, so orphans can be found. */
        private const val VIEW_TAG = "SNSOCCER_OVERLAY"
        private const val LONG_PRESS_MS = 800L
        private const val BUTTON_SP = 40f

        // Static on purpose: one button per PROCESS. PluginHost outlives plugin
        // reloads, so a window can outlive the module instance that added it.
        private var button: BubbleView? = null
        private var buttonParams: WindowManager.LayoutParams? = null
        private var open = false
        private var tiles: TilesView? = null
        private var tilesParams: WindowManager.LayoutParams? = null
        private val handles = LinkedHashMap<String, Pair<HandleView, WindowManager.LayoutParams>>()
        private var masks = mutableListOf<View>()
        private var ghost: GhostView? = null
        private var ghostParams: WindowManager.LayoutParams? = null
        /** Piece size on screen, in pixels, as JS draws it on the page. */
        private var pieceSize = 64
        private var ticking = false
        private var tickRunnable: Runnable? = null
        private var notice: View? = null
        /** Whether pen drags lock the pen (a setting), and whether it's locked. */
        private var penLockEnabled = true
        private var penLocked = false
        /** Give the host's state change time to land either way. */
        private const val PEN_LOCK_SETTLE_MS = 200L
    }

    override fun getName(): String = NAME

    private val main = Handler(Looper.getMainLooper())

    private val wm: WindowManager
        get() = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    // ── Helpers ─────────────────────────────────────────────────────────────

    private fun metrics(): DisplayMetrics {
        val m = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(m)
        return m
    }

    @Suppress("DEPRECATION")
    private fun rotation(): Int = wm.defaultDisplay.rotation

    private fun dp(v: Float): Int = (v * ctx.resources.displayMetrics.density).toInt()

    private fun params(w: Int, h: Int, touchable: Boolean): WindowManager.LayoutParams {
        var flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        if (!touchable) flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        return WindowManager.LayoutParams(
            w, h, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, flags, PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP or Gravity.START }
    }

    private fun add(view: View, p: WindowManager.LayoutParams) {
        view.tag = VIEW_TAG
        wm.addView(view, p)
    }

    private fun remove(view: View?) {
        if (view == null) return
        try {
            wm.removeViewImmediate(view)
        } catch (e: Exception) {
            Log.w(TAG, "remove: ${e.message}")
        }
    }

    private fun update(view: View?, p: WindowManager.LayoutParams?) {
        if (view == null || p == null) return
        try {
            wm.updateViewLayout(view, p)
        } catch (e: Exception) {
            Log.w(TAG, "update: ${e.message}")
        }
    }

    /**
     * Remove every window in this process that carries our tag, including ones
     * a previous plugin load added and this instance has no reference to.
     * Reflection into WindowManagerGlobal is the only process-wide list of
     * views; without it the sweep does nothing.
     */
    @Suppress("UNCHECKED_CAST")
    private fun sweepOrphans() {
        val known = mutableSetOf<View>()
        button?.let { known.add(it) }
        tiles?.let { known.add(it) }
        handles.values.forEach { known.add(it.first) }
        known.addAll(masks)
        ghost?.let { known.add(it) }
        try {
            val cls = Class.forName("android.view.WindowManagerGlobal")
            val inst = cls.getMethod("getInstance").invoke(null)
            val field = cls.getDeclaredField("mViews")
            field.isAccessible = true
            val views = ArrayList(field.get(inst) as List<View>)
            var n = 0
            for (v in views) {
                if (v.tag == VIEW_TAG && v !in known) {
                    remove(v)
                    n++
                }
            }
            if (n > 0) Log.i(TAG, "swept $n orphaned window(s)")
        } catch (e: Throwable) {
            Log.w(TAG, "orphan sweep unavailable: ${e.message}")
        }
    }

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
    private fun WritableMap.putPoint(rawX: Float, rawY: Float, toolType: Int) {
        val m = metrics()
        putDouble("x", rawX.toDouble())
        putDouble("y", rawY.toDouble())
        putInt("screenWidth", m.widthPixels)
        putInt("screenHeight", m.heightPixels)
        putInt("rotation", rotation())
        putInt("toolType", toolType)
    }

    private fun rectOf(p: WindowManager.LayoutParams?): Rect? =
        p?.let { Rect(it.x, it.y, it.x + it.width, it.y + it.height) }

    /** Whether a screen point is over the button or the open palette. */
    private fun overControls(x: Float, y: Float): Boolean {
        val xi = x.toInt()
        val yi = y.toInt()
        return rectOf(buttonParams)?.contains(xi, yi) == true ||
            (open && rectOf(tilesParams)?.contains(xi, yi) == true)
    }

    /** Keep the button and palette above the handles. */
    private fun raiseControls() {
        button?.let { v ->
            remove(v)
            buttonParams?.let { add(v, it) }
        }
        tiles?.let { v ->
            remove(v)
            tilesParams?.let { add(v, it) }
        }
    }

    // ── The pen ─────────────────────────────────────────────────────────────

    private fun isPen(e: MotionEvent): Boolean {
        val t = e.getToolType(0)
        return t == MotionEvent.TOOL_TYPE_STYLUS || t == MotionEvent.TOOL_TYPE_ERASER
    }

    /** PluginApp.showPluginView(int), reached through NativePluginManager. */
    private fun setPluginState(state: Int): Boolean {
        return try {
            val manager = ctx.getNativeModule("NativePluginManager") ?: run {
                Log.w(TAG, "pen lock: no NativePluginManager module")
                return false
            }
            var cls: Class<*>? = manager.javaClass
            var field: java.lang.reflect.Field? = null
            while (cls != null && field == null) {
                field = cls.declaredFields.firstOrNull { it.name == "pluginApp" }
                cls = cls.superclass
            }
            val app = field?.let { it.isAccessible = true; it.get(manager) } ?: run {
                Log.w(TAG, "pen lock: no pluginApp field")
                return false
            }
            val show = app.javaClass.methods.firstOrNull {
                it.name == "showPluginView" && it.parameterCount == 1 &&
                    (it.parameterTypes[0] == Int::class.javaPrimitiveType ||
                        it.parameterTypes[0] == Int::class.javaObjectType)
            } ?: run {
                Log.w(TAG, "pen lock: no showPluginView(int)")
                return false
            }
            show.invoke(app, state)
            Log.i(TAG, "pen lock: plugin state $state")
            true
        } catch (e: Throwable) {
            Log.w(TAG, "pen lock: $e")
            false
        }
    }

    /** A pen drag on one of our windows has begun: lock the pen. */
    private fun penDragStarted() {
        emit("penDrag") { putBoolean("active", true) }
        if (!penLockEnabled || penLocked) return
        emit("penLock") { putBoolean("on", true) }
        penLocked = true
        // After the event, so JS knows why its view is about to open.
        main.post {
            if (!setPluginState(1)) {
                penLocked = false
                emit("penLock") { putBoolean("on", false) }
            }
        }
    }

    /** The drag has ended: unlock the pen, then carry on with `then`. */
    private fun penDragEnded(then: () -> Unit) {
        if (!penLocked) {
            emit("penDrag") { putBoolean("active", false) }
            then()
            return
        }
        setPluginState(0)
        penLocked = false
        main.postDelayed({
            emit("penLock") { putBoolean("on", false) }
            emit("penDrag") { putBoolean("active", false) }
            then()
        }, PEN_LOCK_SETTLE_MS)
    }

    // ── The palette's place ─────────────────────────────────────────────────

    /** Put the palette beside the button: below it, or above if there's no room. */
    private fun placeTiles() {
        val b = buttonParams ?: return
        val t = tiles ?: return
        val p = tilesParams ?: return
        val m = metrics()
        val gap = dp(6f)
        p.x = (b.x + b.width / 2 - t.widthPx / 2).coerceIn(0, maxOf(0, m.widthPixels - t.widthPx))
        val below = b.y + b.height + gap
        p.y = if (below + t.heightPx <= m.heightPixels) below else maxOf(0, b.y - gap - t.heightPx)
        update(t, p)
    }

    private fun setOpen(value: Boolean) {
        open = value
        button?.invalidate()
        if (open && tiles == null && button != null) {
            val t = TilesView(ctx, dp(56f))
            attachTileTouches(t)
            val p = params(t.widthPx, t.heightPx, true)
            tiles = t
            tilesParams = p
            add(t, p)
            placeTiles()
        } else if (!open && tiles != null) {
            remove(tiles)
            tiles = null
            tilesParams = null
        }
    }

    // ── Touch: the button ───────────────────────────────────────────────────

    @SuppressLint("ClickableViewAccessibility")
    private fun attachButtonTouches(v: BubbleView) {
        var startX = 0
        var startY = 0
        var downRawX = 0f
        var downRawY = 0f
        var dragging = false
        var longPressed = false
        var pen = false
        val longPress = Runnable {
            longPressed = true
            emit("longPress")
        }
        v.setOnTouchListener { _, e ->
            val p = buttonParams ?: return@setOnTouchListener false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = p.x
                    startY = p.y
                    downRawX = e.rawX
                    downRawY = e.rawY
                    dragging = false
                    longPressed = false
                    pen = isPen(e)
                    main.postDelayed(longPress, LONG_PRESS_MS)
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downRawX
                    val dy = e.rawY - downRawY
                    if (!dragging && (abs(dx) > dp(6f) || abs(dy) > dp(6f))) {
                        dragging = true
                        main.removeCallbacks(longPress)
                        if (pen) penDragStarted()
                    }
                    if (dragging) {
                        val m = metrics()
                        p.x = (startX + dx.toInt()).coerceIn(0, maxOf(0, m.widthPixels - p.width))
                        p.y = (startY + dy.toInt()).coerceIn(0, maxOf(0, m.heightPixels - p.height))
                        update(v, p)
                        placeTiles()
                    }
                }
                MotionEvent.ACTION_UP -> {
                    main.removeCallbacks(longPress)
                    when {
                        longPressed -> {} // the hold already opened the menu
                        dragging -> penDragEnded {
                            emit("position") {
                                putInt("x", p.x)
                                putInt("y", p.y)
                            }
                        }
                        else -> {
                            setOpen(!open)
                            emit("open") { putBoolean("open", open) }
                        }
                    }
                }
                MotionEvent.ACTION_CANCEL -> {
                    main.removeCallbacks(longPress)
                    if (dragging) penDragEnded {}
                }
            }
            true
        }
    }

    // ── Touch: dragging a new piece out of the palette ──────────────────────

    @SuppressLint("ClickableViewAccessibility")
    private fun attachTileTouches(t: TilesView) {
        var kind: String? = null
        var downRawX = 0f
        var downRawY = 0f
        t.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    kind = t.kindAt(e.y)
                    t.pressed = kind
                    downRawX = e.rawX
                    downRawY = e.rawY
                    kind?.let { showGhost(it, e.rawX, e.rawY) }
                    // A piece is always dragged out, so lock at once.
                    if (kind != null && isPen(e)) penDragStarted()
                }
                MotionEvent.ACTION_MOVE -> moveGhost(e.rawX, e.rawY)
                MotionEvent.ACTION_UP -> {
                    val k = kind
                    t.pressed = null
                    hideGhost()
                    if (k != null) {
                        val moved = abs(e.rawX - downRawX) > dp(8f) || abs(e.rawY - downRawY) > dp(8f)
                        val rawX = e.rawX
                        val rawY = e.rawY
                        val tool = e.getToolType(0)
                        val over = overControls(rawX, rawY)
                        penDragEnded {
                            if (moved && !over) {
                                emit("drop") {
                                    putString("kind", k)
                                    putPoint(rawX, rawY, tool)
                                }
                            } else if (!moved) {
                                emit("tapPiece") { putString("kind", k) }
                            }
                        }
                    }
                    kind = null
                }
                MotionEvent.ACTION_CANCEL -> {
                    t.pressed = null
                    hideGhost()
                    if (kind != null) penDragEnded {}
                    kind = null
                }
            }
            true
        }
    }

    private fun showGhost(kind: String, rawX: Float, rawY: Float) {
        hideGhost()
        val g = GhostView(ctx, kind)
        val p = params(pieceSize, pieceSize, false)
        p.x = (rawX - pieceSize / 2f).toInt()
        p.y = (rawY - pieceSize / 2f).toInt()
        try {
            add(g, p)
            ghost = g
            ghostParams = p
        } catch (e: Exception) {
            Log.w(TAG, "ghost: ${e.message}")
        }
    }

    private fun moveGhost(rawX: Float, rawY: Float) {
        val p = ghostParams ?: return
        p.x = (rawX - pieceSize / 2f).toInt()
        p.y = (rawY - pieceSize / 2f).toInt()
        update(ghost, p)
    }

    private fun hideGhost() {
        remove(ghost)
        ghost = null
        ghostParams = null
    }

    // ── Touch: moving a piece already on the page ───────────────────────────

    private fun handleSize(): Int = (pieceSize * 1.15f).toInt()

    @SuppressLint("ClickableViewAccessibility")
    private fun attachHandleTouches(h: HandleView) {
        var startX = 0
        var startY = 0
        var downRawX = 0f
        var downRawY = 0f
        var dragging = false
        var pen = false
        h.setOnTouchListener { _, e ->
            val p = handles[h.id]?.second ?: return@setOnTouchListener false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = p.x
                    startY = p.y
                    downRawX = e.rawX
                    downRawY = e.rawY
                    dragging = false
                    pen = isPen(e)
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downRawX
                    val dy = e.rawY - downRawY
                    if (!dragging && (abs(dx) > dp(6f) || abs(dy) > dp(6f))) {
                        dragging = true
                        if (pen) penDragStarted()
                        // Hide the piece the note is still drawing at its old
                        // spot, and let the handle carry a drawn copy.
                        val mask = MaskView(ctx)
                        val mp = params(p.width, p.height, false)
                        mp.x = startX
                        mp.y = startY
                        try {
                            add(mask, mp)
                            masks.add(mask)
                        } catch (_: Exception) {}
                        h.carrying = true
                        raiseControls()
                    }
                    if (dragging) {
                        p.x = startX + dx.toInt()
                        p.y = startY + dy.toInt()
                        update(h, p)
                    }
                }
                MotionEvent.ACTION_UP -> {
                    if (dragging) {
                        val over = overControls(e.rawX, e.rawY)
                        val cx = p.x + p.width / 2f
                        val cy = p.y + p.height / 2f
                        val tool = e.getToolType(0)
                        penDragEnded {
                            if (over) {
                                emit("remove") { putString("id", h.id) }
                            } else {
                                emit("move") {
                                    putString("id", h.id)
                                    putPoint(cx, cy, tool)
                                }
                            }
                        }
                    }
                    // The handle keeps carrying the piece, and the mask stays,
                    // until JS has rewritten the page and calls setPieces.
                }
                MotionEvent.ACTION_CANCEL -> {
                    if (dragging) {
                        p.x = startX
                        p.y = startY
                        update(h, p)
                        h.carrying = false
                        clearMasks()
                        penDragEnded {}
                    }
                }
            }
            true
        }
    }

    private fun clearMasks() {
        masks.forEach { remove(it) }
        masks.clear()
    }

    // ── JS API ──────────────────────────────────────────────────────────────

    @ReactMethod
    fun canDrawOverlays(promise: Promise) {
        val ok = Settings.canDrawOverlays(ctx)
        Log.i(TAG, "canDrawOverlays = $ok (package ${ctx.packageName})")
        promise.resolve(ok)
    }

    @ReactMethod
    fun requestOverlayPermission() {
        try {
            ctx.startActivity(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.packageName))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (e: Exception) {
            Log.e(TAG, "requestOverlayPermission: ${e.message}", e)
        }
    }

    @ReactMethod
    fun getScreenInfo(promise: Promise) {
        val m = metrics()
        val map = Arguments.createMap()
        map.putInt("width", m.widthPixels)
        map.putInt("height", m.heightPixels)
        map.putDouble("density", m.density.toDouble())
        map.putInt("rotation", rotation())
        promise.resolve(map)
    }

    /**
     * Show the button (and the palette, if `open`). options: x, y (screen px;
     * default top right), open, pieceSize (screen px). Resolves false without
     * the overlay permission.
     */
    @ReactMethod
    fun show(options: ReadableMap, promise: Promise) {
        main.post {
            try {
                if (!Settings.canDrawOverlays(ctx)) {
                    Log.w(TAG, "show: no overlay permission for ${ctx.packageName}")
                    promise.resolve(false)
                    return@post
                }
                if (options.hasKey("pieceSize")) pieceSize = options.getDouble("pieceSize").toInt()
                if (options.hasKey("penLock")) penLockEnabled = options.getBoolean("penLock")
                val m = metrics()
                if (button == null) {
                    sweepOrphans()
                    val size = TypedValue.applyDimension(
                        TypedValue.COMPLEX_UNIT_SP, BUTTON_SP, ctx.resources.displayMetrics,
                    ).toInt()
                    val v = BubbleView(ctx) { open }
                    attachButtonTouches(v)
                    val p = params(size, size, true)
                    p.x = m.widthPixels - size - dp(16f)
                    p.y = dp(120f)
                    button = v
                    buttonParams = p
                    add(v, p)
                }
                val p = buttonParams!!
                if (options.hasKey("x")) p.x = options.getDouble("x").toInt()
                if (options.hasKey("y")) p.y = options.getDouble("y").toInt()
                p.x = p.x.coerceIn(0, maxOf(0, m.widthPixels - p.width))
                p.y = p.y.coerceIn(0, maxOf(0, m.heightPixels - p.height))
                update(button, p)
                setOpen(if (options.hasKey("open")) options.getBoolean("open") else open)
                placeTiles()
                Log.i(TAG, "show: button at ${p.x},${p.y} size ${p.width}, palette open=$open")
                promise.resolve(true)
            } catch (e: Throwable) {
                // Throwable, not Exception: a class that fails to load is an
                // Error, and the menu should hear about that too.
                Log.e(TAG, "show: $e", e)
                promise.reject("show_failed", e.toString(), e)
            }
        }
    }

    /** Take every window down: button, palette and handles. */
    @ReactMethod
    fun hide() {
        main.post { hideAll() }
    }

    private fun hideAll() {
        if (penLocked) {
            setPluginState(0)
            penLocked = false
        }
        hideGhost()
        clearMasks()
        handles.values.forEach { remove(it.first) }
        handles.clear()
        remove(tiles)
        tiles = null
        tilesParams = null
        remove(button)
        button = null
        buttonParams = null
        sweepOrphans()
    }

    @ReactMethod
    fun isShowing(promise: Promise) {
        promise.resolve(button != null)
    }

    /**
     * Put a handle over each piece on the current page: [{id, kind, x, y}],
     * centres in screen pixels. Pieces not in the list lose their handle.
     */
    @ReactMethod
    fun setPieces(pieces: ReadableArray, size: Double) {
        main.post {
            try {
                pieceSize = size.toInt()
                clearMasks()
                if (button == null) return@post
                val want = LinkedHashMap<String, Triple<String, Float, Float>>()
                for (i in 0 until pieces.size()) {
                    val p = pieces.getMap(i) ?: continue
                    val id = p.getString("id") ?: continue
                    val kind = p.getString("kind") ?: continue
                    want[id] = Triple(kind, p.getDouble("x").toFloat(), p.getDouble("y").toFloat())
                }
                for (id in handles.keys.toList()) {
                    if (id !in want) remove(handles.remove(id)?.first)
                }
                val hs = handleSize()
                var added = false
                for ((id, spec) in want) {
                    val (kind, x, y) = spec
                    val existing = handles[id]
                    if (existing != null) {
                        val (v, p) = existing
                        v.kind = kind
                        v.carrying = false
                        p.width = hs
                        p.height = hs
                        p.x = (x - hs / 2f).toInt()
                        p.y = (y - hs / 2f).toInt()
                        update(v, p)
                    } else {
                        val v = HandleView(ctx, id, kind)
                        attachHandleTouches(v)
                        val p = params(hs, hs, true)
                        p.x = (x - hs / 2f).toInt()
                        p.y = (y - hs / 2f).toInt()
                        add(v, p)
                        handles[id] = v to p
                        added = true
                    }
                }
                if (added) raiseControls()
            } catch (e: Exception) {
                Log.e(TAG, "setPieces: ${e.message}", e)
            }
        }
    }

    /**
     * A short message at the bottom of the screen, for a few seconds. Android
     * may not show a background app's toast, and with the panel closed the
     * plugin is one; an overlay window always shows.
     */
    @ReactMethod
    fun notify(message: String) {
        main.post {
            try {
                remove(notice)
                val m = metrics()
                val v = NoticeView(ctx, message, dp(18f).toFloat(), dp(18f))
                val p = params(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, false)
                p.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                p.y = m.heightPixels / 12
                add(v, p)
                notice = v
                main.postDelayed({
                    if (notice === v) {
                        remove(v)
                        notice = null
                    }
                }, 4000L)
            } catch (e: Throwable) {
                Log.w(TAG, "notify: $e")
            }
        }
    }

    /** Emit "tick" every intervalMs, since JS timers stop with the panel closed. */
    @ReactMethod
    fun startTicking(intervalMs: Double) {
        main.post {
            if (ticking) return@post
            ticking = true
            val interval = maxOf(300L, intervalMs.toLong())
            val r = object : Runnable {
                override fun run() {
                    if (!ticking) return
                    emit("tick")
                    main.postDelayed(this, interval)
                }
            }
            tickRunnable = r
            main.postDelayed(r, interval)
        }
    }

    @ReactMethod
    fun stopTicking() {
        main.post {
            ticking = false
            tickRunnable?.let { main.removeCallbacks(it) }
            tickRunnable = null
        }
    }

    // Required by NativeEventEmitter on the JS side.
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Double) {}

    override fun invalidate() {
        main.post {
            ticking = false
            tickRunnable?.let { main.removeCallbacks(it) }
            hideAll()
        }
        super.invalidate()
    }
}
