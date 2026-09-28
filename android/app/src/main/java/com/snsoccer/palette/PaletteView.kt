package com.snsoccer.palette

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View

/**
 * The floating palette: a narrow strip that stays over the note while the user
 * writes.
 *
 *   ⠿      grip: drag to move the palette up, down, or to the other side
 *   X O ▲ ●  piece tiles: drag one onto the page with a finger
 *   Move   drag pieces already on the page
 *   Copy   copy this page to the next one
 *   Pitch  add a page with a pitch background
 *   Hide   put the palette away
 *
 * A touch that starts in this window keeps being delivered to it even after
 * the finger leaves the strip, which is what lets a piece be dragged out onto
 * the page. Touches anywhere else go to the note as usual.
 */
@SuppressLint("ViewConstructor")
class PaletteView(context: Context, private val listener: Listener) : View(context) {

    interface Listener {
        fun onPieceDragStart(kind: String, rawX: Float, rawY: Float)
        fun onPieceDragMove(rawX: Float, rawY: Float)
        /** `outside` is true when released away from the palette. */
        fun onPieceDragEnd(kind: String, rawX: Float, rawY: Float, outside: Boolean, toolType: Int)
        fun onPieceDragCancel()
        fun onAction(action: String)
        fun onGripDrag(dxRaw: Float, dyRaw: Float)
        fun onGripRelease()
    }

    companion object {
        const val ACTION_MOVE = "move"
        const val ACTION_COPY = "copy"
        const val ACTION_PITCH = "pitch"
        const val ACTION_HIDE = "hide"
        private val ACTIONS = listOf(
            ACTION_MOVE to "Move",
            ACTION_COPY to "Copy",
            ACTION_PITCH to "Pitch",
            ACTION_HIDE to "Hide",
        )
    }

    private val density = resources.displayMetrics.density
    /** Tile edge: also each control's touch target. 60dp is ~8mm. */
    val tile = 60f * density
    private val pad = 6f * density
    private val gripH = 30f * density
    private val border = 2f * density

    private sealed class Item(val rect: RectF) {
        class Grip(rect: RectF) : Item(rect)
        class Piece(rect: RectF, val kind: String) : Item(rect)
        class Action(rect: RectF, val action: String, val label: String) : Item(rect)
    }

    private val items: List<Item> = buildList {
        var y = pad
        add(Item.Grip(RectF(pad, y, pad + tile, y + gripH)))
        y += gripH
        for (kind in Glyphs.KINDS) {
            add(Item.Piece(RectF(pad, y, pad + tile, y + tile), kind))
            y += tile
        }
        y += pad
        for ((action, label) in ACTIONS) {
            add(Item.Action(RectF(pad, y, pad + tile, y + tile * 0.8f), action, label))
            y += tile * 0.8f
        }
    }

    val widthPx: Int = (tile + 2 * pad).toInt()
    val heightPx: Int = (items.last().rect.bottom + pad).toInt()

    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF000000.toInt() }
    private val paper = Paint().apply { color = 0xFFFFFFFF.toInt() }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF000000.toInt()
        textAlign = Paint.Align.CENTER
        textSize = 15f * density
        isFakeBoldText = true
    }

    private var pressed: Item? = null
    private var dragging: Item.Piece? = null
    private var lastRawX = 0f
    private var lastRawY = 0f

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(widthPx, heightPx)
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paper)
        ink.style = Paint.Style.STROKE
        ink.strokeWidth = border
        canvas.drawRect(border / 2, border / 2, width - border / 2, height - border / 2, ink)

        for (item in items) {
            val r = item.rect
            val down = item === pressed
            if (down) {
                ink.style = Paint.Style.FILL
                canvas.drawRect(r, ink)
            }
            when (item) {
                is Item.Grip -> {
                    ink.style = Paint.Style.FILL
                    val dot = 2.5f * density
                    for (row in 0..1) for (col in 0..2) {
                        canvas.drawCircle(
                            r.centerX() + (col - 1) * 4 * dot,
                            r.centerY() + (row - 0.5f) * 4 * dot,
                            dot,
                            if (down) paper else ink,
                        )
                    }
                }
                is Item.Piece -> Glyphs.draw(canvas, item.kind, r.centerX(), r.centerY(), tile * 0.62f)
                is Item.Action -> {
                    text.color = if (down) 0xFFFFFFFF.toInt() else 0xFF000000.toInt()
                    canvas.drawText(item.label, r.centerX(), r.centerY() + text.textSize / 3, text)
                    ink.style = Paint.Style.STROKE
                    ink.strokeWidth = density
                    canvas.drawLine(r.left, r.top, r.right, r.top, ink)
                }
            }
        }
    }

    private fun itemAt(x: Float, y: Float): Item? = items.firstOrNull { it.rect.contains(x, y) }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                pressed = itemAt(e.x, e.y)
                lastRawX = e.rawX
                lastRawY = e.rawY
                val item = pressed
                if (item is Item.Piece) {
                    dragging = item
                    listener.onPieceDragStart(item.kind, e.rawX, e.rawY)
                }
                invalidate()
                return pressed != null
            }
            MotionEvent.ACTION_MOVE -> {
                when (val item = pressed) {
                    is Item.Grip -> {
                        listener.onGripDrag(e.rawX - lastRawX, e.rawY - lastRawY)
                        lastRawX = e.rawX
                        lastRawY = e.rawY
                    }
                    is Item.Piece -> listener.onPieceDragMove(e.rawX, e.rawY)
                    else -> {}
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                val item = pressed
                pressed = null
                invalidate()
                when (item) {
                    is Item.Grip -> listener.onGripRelease()
                    is Item.Piece -> {
                        dragging = null
                        val outside = e.x < 0 || e.y < 0 || e.x > width || e.y > height
                        listener.onPieceDragEnd(item.kind, e.rawX, e.rawY, outside, e.getToolType(0))
                    }
                    is Item.Action -> if (item.rect.contains(e.x, e.y)) listener.onAction(item.action)
                    null -> {}
                }
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                if (dragging != null) listener.onPieceDragCancel()
                dragging = null
                pressed = null
                invalidate()
                return true
            }
        }
        return super.onTouchEvent(e)
    }
}
