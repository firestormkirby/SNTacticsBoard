package com.snsoccer.palette

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.view.View

/**
 * The views behind each overlay window. They only draw; touch handling lives
 * in SoccerPaletteModule, which owns the windows and moves them.
 */

/** The floating button: a round chip with the pitch icon. Inverted while open. */
@SuppressLint("ViewConstructor")
class BubbleView(context: Context, private val isOpen: () -> Boolean) : View(context) {
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
        Glyphs.drawPitchIcon(
            canvas, w / 2, w / 2, r * 1.25f,
            if (open) 0xFFFFFFFF.toInt() else 0xFF000000.toInt(),
        )
    }
}

/** The palette: the four piece tiles in a column. */
@SuppressLint("ViewConstructor")
class TilesView(context: Context, val tile: Int) : View(context) {
    val pad = tile / 10
    val widthPx = tile + 2 * pad
    val heightPx = Glyphs.KINDS.size * tile + 2 * pad
    var pressed: String? = null
        set(value) {
            field = value
            invalidate()
        }

    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF000000.toInt() }
    private val paper = Paint().apply { color = 0xFFFFFFFF.toInt() }

    /** Which piece a point in this view falls on, if any. */
    fun kindAt(y: Float): String? {
        val i = ((y - pad) / tile).toInt()
        return if (y >= pad && i in Glyphs.KINDS.indices) Glyphs.KINDS[i] else null
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paper)
        ink.style = Paint.Style.STROKE
        ink.strokeWidth = maxOf(2f, tile * 0.04f)
        canvas.drawRect(ink.strokeWidth / 2, ink.strokeWidth / 2, width - ink.strokeWidth / 2, height - ink.strokeWidth / 2, ink)
        Glyphs.KINDS.forEachIndexed { i, kind ->
            val top = (pad + i * tile).toFloat()
            if (kind == pressed) {
                ink.style = Paint.Style.FILL
                canvas.drawRect(pad.toFloat(), top, (pad + tile).toFloat(), top + tile, ink)
            }
            Glyphs.draw(canvas, kind, pad + tile / 2f, top + tile / 2f, tile * 0.62f)
        }
    }
}

/**
 * A piece's touch window, sitting exactly over a piece the note has drawn.
 * Invisible at rest, so the note's own drawing shows through; while it is
 * being dragged it draws the piece itself, since it is carrying it.
 */
@SuppressLint("ViewConstructor")
class HandleView(context: Context, val id: String, var kind: String) : View(context) {
    var carrying = false
        set(value) {
            field = value
            invalidate()
        }

    override fun onDraw(canvas: Canvas) {
        if (carrying) Glyphs.draw(canvas, kind, width / 2f, height / 2f, width * 0.85f)
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
