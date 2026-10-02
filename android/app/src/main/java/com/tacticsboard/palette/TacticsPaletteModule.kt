package com.tacticsboard.palette

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
 * Tactics Board's floating button, palette and piece handles ("TacticsPalette").
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
 * by JS (src/palette/controller.ts), from one event stream, "TacticsPalette",
 * whose `type` says what happened.
 *
 * PEN
 *           On a Supernote the pen also writes into the note through the
 *           digitizer, whatever window it's over, so a pen drag on these
 *           windows would draw a line. So the pen is locked the way the
 *           Supernote plugin notes describe: the host's PluginApp is put in
 *           state 1, which makes the Note app disable the pen full-screen,
 *           and back in state 0 afterwards (reflection: the SDK's own
 *           showPluginView has no state argument). It locks as soon as the
 *           pen hovers over one of the windows, before it touches, and at
 *           the latest when a drag starts; it unlocks when the drag ends or
 *           the pen hovers away. JS is told ("penLock", "penDrag") so it can
 *           keep its panel out of the way and clean up any stroke that got
 *           through before the lock landed.
 *
 * Details carried over from Modulanner's PlannerOverlayModule, which adapted
 * them from SuperDashboard by AgP42 (MIT, github.com/AgP42/SuperDashboard):
 * PixelFormat.TRANSLUCENT (an opaque overlay turns round chips into black
 * squares on Manta), SP sizing for the button, a long press that is long on
 * purpose (slow e-ink taps trip a short one), a native tick because PluginHost
 * suspends JS timers while the panel is closed, and a sweep for windows left
 * behind by a previous plugin load.
 */
class TacticsPaletteModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

    companion object {
        const val NAME = "TacticsPalette"
        const val EVENT = "TacticsPalette"
        private const val TAG = "TacticsPalette"
        /** On every window this module adds, so orphans can be found. */
        private const val VIEW_TAG = "TACTICSBOARD_OVERLAY"
        private const val LONG_PRESS_MS = 800L
        private const val BUTTON_SP = 40f

        // Static on purpose: one button per PROCESS. PluginHost outlives plugin
        // reloads, so a window can outlive the module instance that added it.
        private var button: BubbleView? = null
        private var buttonParams: WindowManager.LayoutParams? = null
        private var open = false
        private var tiles: TilesView? = null
        private var tilesParams: WindowManager.LayoutParams? = null
        /** The palette's name tag: the page's board, or Scratchpad. */
        private var pageName = "Scratchpad"
        /** Saved boards for the Load list: keyword to name. */
        private var boards: List<Pair<String, String>> = emptyList()
        private var loadList: LoadListView? = null
        private var loadListParams: WindowManager.LayoutParams? = null
        /** How long Reset or Trash waits for its second tap. */
        private const val ARMED_MS = 3000L
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
        /** How long after an edit returns the Note app's redraw is on screen. */
        private const val NOTE_REDRAW_MS = 900L
        /** Longest a dropped piece is shown before the note has drawn it. */
        private const val LANDING_TIMEOUT_MS = 5000L
        /** After a pen tap on a piece tile, the longest the lock waits for a hover-away. */
        private const val TAP_RELEASE_MS = 1500L
        /** How long the pen may be away from our windows before a hover lock lifts. */
        private const val HOVER_RELEASE_MS = 300L
        /** JS is editing the note, so a hover mustn't open our view now. */
        private var noteBusy = false
        /** A touch on one of our windows is under way. */
        private var touching = false
        /** Where the pen last lifted, until it hovers out of the window there. */
        private var liftX = 0
        private var liftY = 0
        private var liftHeld = false
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

    /**
     * Keep the button and palette above a window just added at `r`. Only
     * when they overlap: re-adding them makes them blink on e-ink.
     */
    private fun raiseControlsOver(r: Rect) {
        val overlaps = rectOf(buttonParams)?.let { Rect.intersects(it, r) } == true ||
            rectOf(tilesParams)?.let { Rect.intersects(it, r) } == true
        if (overlaps) raiseControls()
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

    private fun lockPen(why: String) {
        main.removeCallbacks(hoverRelease)
        if (!penLockEnabled || penLocked) return
        emit("penLock") { putBoolean("on", true) }
        penLocked = true
        Log.i(TAG, "pen lock: on ($why)")
        // After the event, so JS knows why its view is about to open.
        main.post {
            if (!setPluginState(1)) {
                penLocked = false
                emit("penLock") { putBoolean("on", false) }
            }
        }
    }

    /**
     * Unlock the pen, then carry on with `then` once the unlock has landed.
     * JS hears of the unlock after `then`'s events, so a drop is already in
     * its queue when the queue restarts, and a queued stroke clean-up can
     * leave the strokes to the drop's edit.
     */
    private fun unlockPen(then: () -> Unit) {
        main.removeCallbacks(hoverRelease)
        if (!penLocked) {
            then()
            return
        }
        setPluginState(0)
        penLocked = false
        main.postDelayed({
            then()
            emit("penLock") { putBoolean("on", false) }
        }, PEN_LOCK_SETTLE_MS)
    }

    /**
     * A pen drag on one of our windows has begun: lock the pen. `from` says
     * which ("button", "palette" or "piece"), and `locks` whether locking is
     * on: with it off, JS leaves the strokes a piece dragged on the page drew.
     */
    private fun penDragStarted(from: String) {
        emit("penDrag") {
            putBoolean("active", true)
            putString("from", from)
            putBoolean("locks", penLockEnabled)
        }
        lockPen("drag")
    }

    /** The drag has ended: unlock the pen, then carry on with `then`. */
    private fun penDragEnded(then: () -> Unit) {
        unlockPen {
            emit("penDrag") { putBoolean("active", false) }
            then()
        }
    }

    // ── The pen, before it touches ──────────────────────────────────────────
    //
    // Locking at the start of a drag is too late to keep the drag's first
    // stretch of ink off the screen: the digitizer draws from the moment the
    // pen lands, and the lock takes ~150 ms to reach the Note app. So the pen
    // is locked as soon as it hovers over the button, the palette or a piece
    // (the Wacom digitizer reports the pen in range before it touches), and
    // unlocked once it has hovered away. A window the pen has just let go of
    // doesn't lock again until the pen leaves it: after a drop or a move the
    // pen is usually resting right over the piece it placed.

    private val hoverRelease = Runnable {
        if (!touching && penLocked) {
            Log.i(TAG, "pen lock: off (hovered away)")
            unlockPen {}
        }
    }

    private fun touchStarted() {
        touching = true
        main.removeCallbacks(hoverRelease)
    }

    private fun touchEnded(rawX: Float, rawY: Float) {
        touching = false
        liftX = rawX.toInt()
        liftY = rawY.toInt()
        liftHeld = true
    }

    private fun windowRect(v: View): Rect? {
        val p = when {
            v === button -> buttonParams
            v === tiles -> tilesParams
            v is HandleView -> handles[v.id]?.second
            else -> null
        }
        return rectOf(p)
    }

    private fun hoverMayLock(v: View): Boolean {
        if (!penLockEnabled || penLocked || noteBusy || touching) return false
        return !(liftHeld && windowRect(v)?.contains(liftX, liftY) == true)
    }

    private fun attachHover(v: View) {
        v.setOnHoverListener { _, e ->
            if (!isPen(e)) return@setOnHoverListener false
            when (e.actionMasked) {
                MotionEvent.ACTION_HOVER_ENTER, MotionEvent.ACTION_HOVER_MOVE -> {
                    main.removeCallbacks(hoverRelease)
                    if (hoverMayLock(v)) lockPen("hover")
                }
                MotionEvent.ACTION_HOVER_EXIT -> {
                    if (windowRect(v)?.contains(liftX, liftY) == true) liftHeld = false
                    if (penLocked && !touching) {
                        main.removeCallbacks(hoverRelease)
                        main.postDelayed(hoverRelease, HOVER_RELEASE_MS)
                    }
                }
            }
            false
        }
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
        placeLoadList()
    }

    /** The Load list beside the palette: left of it, or right if there's no room. */
    private fun placeLoadList() {
        val t = tilesParams ?: return
        val v = loadList ?: return
        val p = loadListParams ?: return
        val m = metrics()
        val gap = dp(6f)
        p.x = if (t.x - v.widthPx - gap >= 0) t.x - v.widthPx - gap else t.x + t.width + gap
        p.y = (t.y + t.height / 2).coerceIn(0, maxOf(0, m.heightPixels - v.heightPx))
        update(v, p)
    }

    private fun showLoadList() {
        hideLoadList()
        val v = LoadListView(ctx, boards.map { it.second }, ctx.resources.displayMetrics.density)
        attachLoadListTouches(v)
        val p = params(v.widthPx, v.heightPx, true)
        loadList = v
        loadListParams = p
        add(v, p)
        placeLoadList()
        tiles?.loadOpen = true
    }

    private fun hideLoadList() {
        remove(loadList)
        loadList = null
        loadListParams = null
        tiles?.loadOpen = false
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun attachLoadListTouches(v: LoadListView) {
        v.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> v.pressed = v.rowAt(e.y)
                MotionEvent.ACTION_UP -> {
                    val i = v.rowAt(e.y)
                    v.pressed = -1
                    if (i >= 0 && i < boards.size) {
                        val keyword = boards[i].first
                        hideLoadList()
                        emit("load") { putString("keyword", keyword) }
                    }
                }
                MotionEvent.ACTION_CANCEL -> v.pressed = -1
            }
            true
        }
    }

    private val disarm = Runnable { tiles?.armed = null }

    /**
     * Reset and Trash take two taps: the first arms the icon (drawn inverted)
     * and says so, a second within ARMED_MS acts. Anything else disarms it.
     */
    private fun twoTaps(t: TilesView, action: String, first: String, event: String) {
        main.removeCallbacks(disarm)
        if (t.armed != action) {
            t.armed = action
            main.postDelayed(disarm, ARMED_MS)
            notify(first)
        } else {
            t.armed = null
            emit(event)
        }
    }

    /** Save, Load, Copy, Reset or Trash tapped on the palette. */
    private fun onAction(action: String) {
        val t = tiles ?: return
        if (action != t.armed) {
            main.removeCallbacks(disarm)
            t.armed = null
        }
        when (action) {
            Glyphs.SAVE -> {
                hideLoadList()
                emit("save")
            }
            Glyphs.LOAD -> if (loadList != null) hideLoadList() else showLoadList()
            Glyphs.COPY -> {
                hideLoadList()
                emit("copy")
            }
            Glyphs.RESET -> {
                hideLoadList()
                twoTaps(t, action, "Tap again to reset this page.", "reset")
            }
            Glyphs.TRASH -> {
                // Pieces are dragged onto it; tapped twice, it clears the page.
                hideLoadList()
                twoTaps(t, action, "Tap again to clear this page.", "clear")
            }
        }
    }

    /** Whether a screen point is over the palette's trash row. */
    private fun overTrash(x: Float, y: Float): Boolean {
        val t = tiles ?: return false
        val p = tilesParams ?: return false
        if (!open) return false
        val (top, bottom) = t.trashBand()
        return Rect(p.x, p.y + top, p.x + p.width, p.y + bottom).contains(x.toInt(), y.toInt())
    }

    private fun setOpen(value: Boolean) {
        open = value
        button?.invalidate()
        if (open && tiles == null && button != null) {
            val t = TilesView(ctx, dp(56f), ctx.resources.displayMetrics.density)
            t.pageName = pageName
            attachTileTouches(t)
            val p = params(t.widthPx, t.heightPx, true)
            tiles = t
            tilesParams = p
            add(t, p)
            placeTiles()
        } else if (!open && tiles != null) {
            hideLoadList()
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
            // A hover lock would keep the menu blank: lift it first.
            unlockPen { emit("longPress") }
        }
        attachHover(v)
        v.setOnTouchListener { _, e ->
            val p = buttonParams ?: return@setOnTouchListener false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    touchStarted()
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
                        if (pen) penDragStarted("button")
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
                    touchEnded(e.rawX, e.rawY)
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
                    touchEnded(e.rawX, e.rawY)
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
        var action: String? = null
        var downRawX = 0f
        var downRawY = 0f
        attachHover(t)
        t.setOnTouchListener { _, e ->
            // Save / Load / Reset / Trash: a tap, done on lifting over the
            // same one.
            if (e.actionMasked == MotionEvent.ACTION_DOWN) {
                action = t.actionAt(e.y)
            }
            val a = action
            if (a != null) {
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        touchStarted()
                        t.pressed = a
                    }
                    MotionEvent.ACTION_MOVE -> t.pressed = if (t.actionAt(e.y) == a) a else null
                    MotionEvent.ACTION_UP -> {
                        touchEnded(e.rawX, e.rawY)
                        t.pressed = null
                        action = null
                        if (t.actionAt(e.y) == a) onAction(a)
                    }
                    MotionEvent.ACTION_CANCEL -> {
                        touchEnded(e.rawX, e.rawY)
                        t.pressed = null
                        action = null
                    }
                }
                return@setOnTouchListener true
            }
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    touchStarted()
                    kind = t.kindAt(e.y)
                    t.pressed = kind
                    downRawX = e.rawX
                    downRawY = e.rawY
                    kind?.let { showGhost(it, e.rawX, e.rawY) }
                    // A piece is always dragged out, so lock at once.
                    if (kind != null && isPen(e)) penDragStarted("palette")
                }
                MotionEvent.ACTION_MOVE -> moveGhost(e.rawX, e.rawY)
                MotionEvent.ACTION_UP -> {
                    touchEnded(e.rawX, e.rawY)
                    val k = kind
                    t.pressed = null
                    if (k != null) {
                        val moved = abs(e.rawX - downRawX) > dp(8f) || abs(e.rawY - downRawY) > dp(8f)
                        val rawX = e.rawX
                        val rawY = e.rawY
                        val tool = e.getToolType(0)
                        val over = overControls(rawX, rawY)
                        if (moved && !over) {
                            // Leave the piece showing where it landed until
                            // the note has drawn it (setPieces), or a while.
                            moveGhost(rawX, rawY)
                            val landed = ghost
                            main.postDelayed({ if (ghost === landed) hideGhost() }, LANDING_TIMEOUT_MS)
                        } else {
                            hideGhost()
                        }
                        if (!moved) {
                            // A tap: the pen is still over the palette, likely
                            // to drag next. Unlocking here let the next drag
                            // start unlocked, and the Note app doesn't stop a
                            // stroke already under way: the whole drag inked.
                            // The lock stays until the pen hovers away.
                            emit("penDrag") { putBoolean("active", false) }
                            emit("tapPiece") { putString("kind", k) }
                            // In case no hover-away comes (the pen lifted out
                            // of range): hovering on over the palette cancels.
                            main.removeCallbacks(hoverRelease)
                            main.postDelayed(hoverRelease, TAP_RELEASE_MS)
                            kind = null
                            return@setOnTouchListener true
                        }
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
                    touchEnded(e.rawX, e.rawY)
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

    /** A handle while it's carrying its piece: room to draw all of it. */
    private fun handleSize(): Int = (pieceSize * 1.15f).toInt()

    /**
     * A handle at rest: the middle of what the piece draws, not its box, so
     * a line drawn close by doesn't pick the piece up. (The ball is drawn
     * about half the box across; the others about four fifths.)
     */
    private fun hitSize(kind: String): Int = (pieceSize * when (kind) {
        Glyphs.BALL -> 0.45f
        Glyphs.DEFENDER -> 0.7f
        else -> 0.65f
    }).toInt()

    @SuppressLint("ClickableViewAccessibility")
    private fun attachHandleTouches(h: HandleView) {
        var startX = 0
        var startY = 0
        var downRawX = 0f
        var downRawY = 0f
        var dragging = false
        var pen = false
        attachHover(h)
        h.setOnTouchListener { _, e ->
            val p = handles[h.id]?.second ?: return@setOnTouchListener false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    touchStarted()
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
                        if (pen) penDragStarted("piece")
                        // Grow from the hit area to the whole piece, about
                        // the same centre, to carry a drawn copy of it.
                        val big = handleSize()
                        startX += (p.width - big) / 2
                        startY += (p.height - big) / 2
                        p.width = big
                        p.height = big
                        // Hide the piece the note is still drawing at its old
                        // spot, and let the handle carry a drawn copy.
                        val mask = MaskView(ctx)
                        val mp = params(big, big, false)
                        mp.x = startX
                        mp.y = startY
                        try {
                            add(mask, mp)
                            masks.add(mask)
                        } catch (_: Exception) {}
                        h.drags++
                        h.carrying = true
                        rectOf(mp)?.let { raiseControlsOver(it) }
                    }
                    if (dragging) {
                        p.x = startX + dx.toInt()
                        p.y = startY + dy.toInt()
                        update(h, p)
                        tiles?.overTrash = overTrash(e.rawX, e.rawY)
                    }
                }
                MotionEvent.ACTION_UP -> {
                    touchEnded(e.rawX, e.rawY)
                    if (dragging) {
                        tiles?.overTrash = false
                        val trash = overTrash(e.rawX, e.rawY)
                        val over = overControls(e.rawX, e.rawY)
                        val cx = p.x + p.width / 2f
                        val cy = p.y + p.height / 2f
                        val tool = e.getToolType(0)
                        if (!trash && over) {
                            // On the button or the palette but not the trash:
                            // back where it was, not removed by a near miss.
                            val hs = hitSize(h.kind)
                            p.x = startX + (p.width - hs) / 2
                            p.y = startY + (p.height - hs) / 2
                            p.width = hs
                            p.height = hs
                            update(h, p)
                            h.carrying = false
                            clearMasks()
                            penDragEnded {}
                        } else {
                            penDragEnded {
                                if (trash) {
                                    emit("remove") { putString("id", h.id) }
                                } else {
                                    emit("move") {
                                        putString("id", h.id)
                                        putPoint(cx, cy, tool)
                                    }
                                }
                            }
                        }
                    }
                    // The handle keeps carrying the piece, and the mask stays,
                    // until JS has rewritten the page and calls setPieces.
                }
                MotionEvent.ACTION_CANCEL -> {
                    touchEnded(e.rawX, e.rawY)
                    tiles?.overTrash = false
                    if (dragging) {
                        val hs = hitSize(h.kind)
                        p.x = startX + (p.width - hs) / 2
                        p.y = startY + (p.height - hs) / 2
                        p.width = hs
                        p.height = hs
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

    /**
     * The note has taken an edit (setPieces follows each one): take down
     * what stood in for it while it did, the white patches over old spots,
     * carried copies and a landed piece. Not at once: the Note app's redraw
     * reaches the screen ~0.5 s after the edit returns, and until then the
     * screen still shows the page as it was.
     */
    private fun settleLanding() {
        val oldMasks = masks.toList()
        masks.clear()
        val landed = ghost
        val carried = handles.values.map { it.first }.filter { it.carrying }.map { it to it.drags }
        main.postDelayed({
            oldMasks.forEach { remove(it) }
            if (landed != null && ghost === landed) hideGhost()
            // Unless it's been picked up again since.
            carried.forEach { (h, drags) ->
                if (h.drags == drags) {
                    h.carrying = false
                    shrinkToHit(h)
                }
            }
        }, NOTE_REDRAW_MS)
    }

    /** Back from carrying size to the hit area, about the same centre. */
    private fun shrinkToHit(h: HandleView) {
        val p = handles[h.id]?.second ?: return
        val hs = hitSize(h.kind)
        p.x += (p.width - hs) / 2
        p.y += (p.height - hs) / 2
        p.width = hs
        p.height = hs
        update(h, p)
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
        main.removeCallbacks(hoverRelease)
        if (penLocked) {
            setPluginState(0)
            penLocked = false
        }
        touching = false
        liftHeld = false
        main.removeCallbacks(disarm)
        hideLoadList()
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
                settleLanding()
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
                val added = mutableListOf<Rect>()
                for ((id, spec) in want) {
                    val (kind, x, y) = spec
                    val hs = hitSize(kind)
                    val existing = handles[id]
                    if (existing != null) {
                        val (v, p) = existing
                        v.kind = kind
                        // Still drawing its piece: full size until it settles.
                        val s = if (v.carrying) handleSize() else hs
                        p.width = s
                        p.height = s
                        p.x = (x - s / 2f).toInt()
                        p.y = (y - s / 2f).toInt()
                        update(v, p)
                    } else {
                        val v = HandleView(ctx, id, kind)
                        attachHandleTouches(v)
                        val p = params(hs, hs, true)
                        p.x = (x - hs / 2f).toInt()
                        p.y = (y - hs / 2f).toInt()
                        add(v, p)
                        handles[id] = v to p
                        rectOf(p)?.let { added.add(it) }
                    }
                }
                added.firstOrNull { r ->
                    rectOf(buttonParams)?.let { Rect.intersects(it, r) } == true ||
                        rectOf(tilesParams)?.let { Rect.intersects(it, r) } == true
                }?.let { raiseControlsOver(it) }
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

    /** The palette's name tag: the page's board, or "Scratchpad". */
    @ReactMethod
    fun setPageName(name: String) {
        main.post {
            pageName = name
            tiles?.pageName = name
        }
    }

    /** The saved boards the Load list offers: [{keyword, name}]. */
    @ReactMethod
    fun setBoards(list: ReadableArray) {
        val next = (0 until list.size()).mapNotNull { i ->
            val b = list.getMap(i) ?: return@mapNotNull null
            val keyword = b.getString("keyword") ?: return@mapNotNull null
            keyword to (b.getString("name") ?: keyword)
        }
        main.post {
            boards = next
            if (loadList != null) showLoadList() // redrawn with the new list
        }
    }

    /** Resolve after `ms`: a timer for JS, whose own timers stop while the panel is closed. */
    @ReactMethod
    fun wait(ms: Double, promise: Promise) {
        main.postDelayed({ promise.resolve(null) }, maxOf(0L, ms.toLong()))
    }

    /** JS is (or has stopped) editing the note: no hover lock meanwhile. */
    /**
     * The bytes in a folder's files, subfolders too, for the menu's Storage
     * line: the SDK's FileUtils has no file sizes. Off the main thread; -1
     * when the folder can't be read.
     */
    @ReactMethod
    fun folderSize(path: String, promise: Promise) {
        Thread {
            try {
                val total = java.io.File(path).walkTopDown()
                    .filter { it.isFile }
                    .sumOf { it.length() }
                promise.resolve(total.toDouble())
            } catch (e: Throwable) {
                Log.w(TAG, "folderSize: $e")
                promise.resolve(-1.0)
            }
        }.start()
    }

    @ReactMethod
    fun setBusy(busy: Boolean) {
        main.post { noteBusy = busy }
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
