package com.tacticsboard.palette

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import android.view.View

/**
 * The views behind each overlay window. They only draw; touch handling lives
 * in TacticsPaletteModule, which owns the windows and moves them.
 */

/**
 * The floating button: a round chip with the pitch icon. Inverted while open;
 * an hourglass instead while the plugin is working on the page.
 */
@SuppressLint("ViewConstructor")
class BubbleView(context: Context, private val isOpen: () -> Boolean) : View(context) {
    var waiting = false
        set(value) { if (field != value) { field = value; invalidate() } }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = 0xFF000000.toInt()
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val stroke = maxOf(2f, w * 0.05f)
        val r = w / 2 - stroke
        val open = isOpen()
        fill.color = if (open) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
        canvas.drawCircle(w / 2, w / 2, r, fill)
        ring.strokeWidth = stroke
        canvas.drawCircle(w / 2, w / 2, r, ring)
        val color = if (open) 0xFFFFFFFF.toInt() else 0xFF000000.toInt()
        if (waiting) {
            Glyphs.drawHourglass(canvas, w / 2, w / 2, r * 1.1f, color)
        } else {
            Glyphs.drawPitchIcon(canvas, w / 2, w / 2, r * 1.25f, color)
        }
    }
}

/**
 * The palette, top to bottom: the page's name, the four pieces, a rule, the
 * page's Save / Load / Reset, another rule, and a tall trash row that pieces
 * on the page are dragged onto to remove them. Sizes as in the browser
 * preview's stand-in (tools/ui-preview/tactics/WebPalette.tsx).
 */
@SuppressLint("ViewConstructor")
class TilesView(context: Context, val tile: Int, density: Float) : View(context) {
    val pad = tile / 10
    private val nameH = (26 * density).toInt()
    private val actionH = (34 * density).toInt()
    private val trashH = tile
    val widthPx = tile + 2 * pad
    private val piecesTop = nameH + pad
    private val actionsTop = piecesTop + Glyphs.KINDS.size * tile + pad
    private val trashTop = actionsTop + Glyphs.PAGE_ACTIONS.size * actionH + pad
    val heightPx = trashTop + trashH + pad

    /** The piece or action being touched, drawn inverted. */
    var pressed: String? = null
        set(value) { field = value; invalidate() }
    var pageName = "Scratchpad"
        set(value) { field = value; invalidate() }
    var loadOpen = false
        set(value) { field = value; invalidate() }
    /** Reset or Trash, tapped once: black until the second tap, or a timeout. */
    var armed: String? = null
        set(value) { field = value; invalidate() }
    /** A piece being dragged is over the trash. */
    var overTrash = false
        set(value) { if (field != value) { field = value; invalidate() } }
    /** The plugin is working on the page: "Working…", and the pieces greyed. */
    var waiting = false
        set(value) { if (field != value) { field = value; invalidate() } }
    private val wash = Paint().apply { color = 0xB3FFFFFF.toInt() }

    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF000000.toInt() }
    private val paper = Paint().apply { color = 0xFFFFFFFF.toInt() }
    private val text = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF000000.toInt()
        textSize = 11 * density
        typeface = Typeface.DEFAULT_BOLD
        textAlign = Paint.Align.CENTER
    }

    /** Which piece a point in this view falls on, if any. */
    fun kindAt(y: Float): String? {
        if (y < piecesTop) return null
        val i = ((y - piecesTop) / tile).toInt()
        return if (i in Glyphs.KINDS.indices) Glyphs.KINDS[i] else null
    }

    /** Which of save, load, reset and trash a point falls on, if any. */
    fun actionAt(y: Float): String? {
        if (y >= trashTop && y < trashTop + trashH) return Glyphs.TRASH
        if (y < actionsTop) return null
        val i = ((y - actionsTop) / actionH).toInt()
        return if (i in Glyphs.PAGE_ACTIONS.indices) Glyphs.PAGE_ACTIONS[i] else null
    }

    /** The trash row, in this view's coordinates. */
    fun trashBand(): Pair<Int, Int> = trashTop to trashTop + trashH

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val line = maxOf(2f, tile * 0.04f)
        canvas.drawRect(0f, 0f, w, height.toFloat(), paper)
        ink.style = Paint.Style.STROKE
        ink.strokeWidth = line
        canvas.drawRect(line / 2, line / 2, w - line / 2, height - line / 2, ink)

        // The name tag, cut short with an ellipsis when it doesn't fit.
        val label = if (waiting) "Working…" else pageName
        val name = TextUtils.ellipsize(label, text, w - 2 * pad, TextUtils.TruncateAt.END)
        val baseline = nameH / 2f - (text.descent() + text.ascent()) / 2
        canvas.drawText(name, 0, name.length, w / 2, baseline, text)
        rule(canvas, nameH.toFloat(), line)

        Glyphs.KINDS.forEachIndexed { i, kind ->
            val top = (piecesTop + i * tile).toFloat()
            if (kind == pressed) {
                ink.style = Paint.Style.FILL
                canvas.drawRect(pad.toFloat(), top, (pad + tile).toFloat(), top + tile, ink)
            }
            Glyphs.draw(canvas, kind, pad + tile / 2f, top + tile / 2f, tile * 0.62f)
        }
        if (waiting) {
            // Greyed: not to be dragged out until the page work is done.
            canvas.drawRect(
                line, piecesTop.toFloat(), w - line,
                (piecesTop + Glyphs.KINDS.size * tile).toFloat(), wash,
            )
        }

        rule(canvas, actionsTop - pad / 2f, line)
        Glyphs.PAGE_ACTIONS.forEachIndexed { i, action ->
            val top = (actionsTop + i * actionH).toFloat()
            val dark = action == pressed ||
                (action == Glyphs.LOAD && loadOpen) ||
                action == armed
            actionRow(canvas, action, top, actionH, actionH * 0.62f, dark, line)
        }

        rule(canvas, trashTop - pad / 2f, line)
        actionRow(
            canvas, Glyphs.TRASH, trashTop.toFloat(), trashH, trashH * 0.72f,
            pressed == Glyphs.TRASH || overTrash || armed == Glyphs.TRASH, line,
        )
    }

    private fun rule(canvas: Canvas, y: Float, line: Float) {
        ink.style = Paint.Style.FILL
        canvas.drawRect(0f, y - line / 2, width.toFloat(), y + line / 2, ink)
    }

    private fun actionRow(
        canvas: Canvas, action: String, top: Float, h: Int, size: Float, dark: Boolean, line: Float,
    ) {
        if (dark) {
            ink.style = Paint.Style.FILL
            canvas.drawRect(line, top, width - line, top + h, ink)
        }
        Glyphs.drawAction(
            canvas, action, width / 2f, top + h / 2f, size,
            if (dark) 0xFFFFFFFF.toInt() else 0xFF000000.toInt(),
        )
    }
}

/**
 * The palette's Load list: the saved boards by name, beside the palette.
 * Tapping one puts it in place of the page (JS does that).
 */
@SuppressLint("ViewConstructor")
class LoadListView(context: Context, val names: List<String>, density: Float) : View(context) {
    private val pad = (6 * density).toInt()
    private val titleH = (26 * density).toInt()
    val rowH = (44 * density).toInt()
    val widthPx = (220 * density).toInt()
    val heightPx = titleH + maxOf(1, names.size) * rowH + 2 * pad

    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF000000.toInt() }
    private val paper = Paint().apply { color = 0xFFFFFFFF.toInt() }
    private val title = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF000000.toInt()
        textSize = 12 * density
        typeface = Typeface.DEFAULT_BOLD
    }
    private val item = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF000000.toInt()
        textSize = 15 * density
    }
    var pressed = -1
        set(value) { field = value; invalidate() }

    /** The board at a point in this view, by index, or -1. */
    fun rowAt(y: Float): Int {
        val i = ((y - pad - titleH) / rowH).toInt()
        return if (y >= pad + titleH && i in names.indices) i else -1
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val line = 3f
        canvas.drawRect(0f, 0f, w, height.toFloat(), paper)
        ink.style = Paint.Style.STROKE
        ink.strokeWidth = line
        canvas.drawRect(line / 2, line / 2, w - line / 2, height - line / 2, ink)
        canvas.drawText("Load a new page.", pad.toFloat(), pad + titleH * 0.7f, title)
        if (names.isEmpty()) {
            item.color = 0xFF555555.toInt()
            canvas.drawText("No saved boards yet.", pad.toFloat(), pad + titleH + rowH * 0.62f, item)
            item.color = 0xFF000000.toInt()
            return
        }
        names.forEachIndexed { i, name ->
            val top = (pad + titleH + i * rowH).toFloat()
            ink.style = Paint.Style.FILL
            if (i == pressed) {
                canvas.drawRect(pad.toFloat(), top, w - pad, top + rowH, ink)
            }
            canvas.drawRect(pad.toFloat(), top, w - pad, top + 1.5f, ink)
            item.color = if (i == pressed) 0xFFFFFFFF.toInt() else 0xFF000000.toInt()
            val shown = TextUtils.ellipsize(name, item, w - 4 * pad, TextUtils.TruncateAt.END)
            canvas.drawText(shown, 0, shown.length, pad * 2f, top + rowH * 0.62f, item)
        }
        item.color = 0xFF000000.toInt()
    }
}

/**
 * A piece's touch window, sitting exactly over a piece the note has drawn.
 * Invisible at rest, so the note's own drawing shows through; while it is
 * being dragged it draws the piece itself, since it is carrying it.
 */
@SuppressLint("ViewConstructor")
class HandleView(context: Context, val id: String, var kind: String) : View(context) {
    /** Counts drags, so a late clean-up from an earlier one leaves this one be. */
    var drags = 0
    var carrying = false
        set(value) {
            field = value
            invalidate()
        }
    /** The plugin is working on the page: a grey wash over the piece. */
    var waiting = false
        set(value) { if (field != value) { field = value; invalidate() } }
    private val wash = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x40000000 }

    override fun onDraw(canvas: Canvas) {
        if (carrying) Glyphs.draw(canvas, kind, width / 2f, height / 2f, width * 0.85f)
        else if (waiting) canvas.drawCircle(width / 2f, height / 2f, width / 2f, wash)
    }
}

/** A plain white patch hiding a piece's old spot until the note redraws it. */
class MaskView(context: Context) : View(context) {
    init {
        setBackgroundColor(0xFFFFFFFF.toInt())
    }
}

/** The new piece following the finger or pen out of the palette. */
@SuppressLint("ViewConstructor")
class GhostView(context: Context, var kind: String) : View(context) {
    override fun onDraw(canvas: Canvas) {
        Glyphs.draw(canvas, kind, width / 2f, height / 2f, width * 0.9f)
    }
}

/** A short message in a bordered box, as the notice window shows it. */
@SuppressLint("ViewConstructor")
class NoticeView(context: Context, private val text: String, textSize: Float, private val pad: Int) :
    View(context) {
    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF000000.toInt()
        this.textSize = textSize
    }
    private val paper = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt() }
    private val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF000000.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 3f
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = ink.measureText(text).toInt() + 2 * pad
        val h = (ink.fontMetrics.let { it.bottom - it.top }).toInt() + 2 * pad
        setMeasuredDimension(w, h)
    }

    override fun onDraw(canvas: Canvas) {
        val r = RectF(1.5f, 1.5f, width - 1.5f, height - 1.5f)
        canvas.drawRoundRect(r, pad / 2f, pad / 2f, paper)
        canvas.drawRoundRect(r, pad / 2f, pad / 2f, border)
        canvas.drawText(text, pad.toFloat(), pad - ink.fontMetrics.top, ink)
    }
}
