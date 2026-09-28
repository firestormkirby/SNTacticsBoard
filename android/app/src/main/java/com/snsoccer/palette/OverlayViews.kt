package com.snsoccer.palette

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs
import kotlin.math.hypot

/** The piece that follows the finger while it is dragged off the palette. */
@SuppressLint("ViewConstructor")
class GhostView(context: Context, var kind: String, private val size: Int) : View(context) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(size, size)
    }

    override fun onDraw(canvas: Canvas) {
        Glyphs.draw(canvas, kind, size / 2f, size / 2f, size * 0.9f)
    }
}

/** A piece already on the page, in screen pixels. */
data class LayerPiece(val id: String, val kind: String, var x: Float, var y: Float)

/**
 * Move mode: a full-screen layer over the note that takes finger touches, so
 * pieces already on the page can be dragged. It draws a dashed box around each
 * piece to show what can be picked up, masks a piece's old spot while it is
 * being dragged, and turns the palette's area into a drop-to-remove zone.
 *
 * The note underneath shows through everywhere else: the layer only paints
 * those marks.
 */
@SuppressLint("ViewConstructor")
class MoveLayerView(context: Context, private val listener: Listener) : View(context) {

    interface Listener {
        fun onPieceMoved(id: String, rawX: Float, rawY: Float, toolType: Int)
        fun onPieceRemoved(id: String)
        fun onDone()
    }

    private val density = resources.displayMetrics.density
    private val pieces = mutableListOf<LayerPiece>()
    private var pieceSize = 60f
    /** Where the palette sits, in screen pixels: dropping there removes. */
    private var trash = RectF()

    private val bannerH = 64f * density
    private val done = RectF()
    private var pressingDone = false
    private var dragging: LayerPiece? = null
    private var dragX = 0f
    private var dragY = 0f
    private var downX = 0f
    private var downY = 0f
    private val slop = 8f * density
    private val location = IntArray(2)

    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF000000.toInt() }
    private val paper = Paint().apply { color = 0xFFFFFFFF.toInt() }
    private val dashed = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF000000.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 2f * density
        pathEffect = DashPathEffect(floatArrayOf(6f * density, 5f * density), 0f)
    }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF000000.toInt()
        textSize = 19f * density
    }

    fun setPieces(list: List<LayerPiece>, sizePx: Float, trashRect: RectF) {
        pieces.clear()
        pieces.addAll(list)
        pieceSize = sizePx
        trash = trashRect
        if (dragging != null && pieces.none { it.id == dragging?.id }) dragging = null
        invalidate()
    }

    /** Screen pixels -> this view's pixels (the window may not start at 0,0). */
    private fun local(rawX: Float, rawY: Float): Pair<Float, Float> {
        getLocationOnScreen(location)
        return Pair(rawX - location[0], rawY - location[1])
    }

    private fun hitSize() = maxOf(pieceSize * 1.3f, 56f * density)

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        // Banner with instructions and Done.
        canvas.drawRect(0f, 0f, w, bannerH, paper)
        ink.style = Paint.Style.STROKE
        ink.strokeWidth = 3f * density
        canvas.drawLine(0f, bannerH, w, bannerH, ink)
        val doneW = 120f * density
        done.set(w - doneW - 12 * density, 10 * density, w - 12 * density, bannerH - 10 * density)
        ink.style = Paint.Style.FILL
        canvas.drawRect(done, if (pressingDone) paper else ink)
        text.textAlign = Paint.Align.CENTER
        text.isFakeBoldText = true
        text.color = if (pressingDone) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
        canvas.drawText("Done", done.centerX(), done.centerY() + text.textSize / 3, text)
        text.textAlign = Paint.Align.LEFT
        text.isFakeBoldText = false
        text.color = 0xFF000000.toInt()
        canvas.drawText(
            "Drag pieces with your finger. Drop one on the palette to remove it.",
            16 * density, bannerH / 2 + text.textSize / 3, text,
        )

        // The palette's spot becomes the remove zone.
        val (tx, ty) = local(trash.left, trash.top)
        val zone = RectF(tx, ty, tx + trash.width(), ty + trash.height())
        val overTrash = dragging != null && zone.contains(dragX, dragY)
        canvas.drawRect(zone, if (overTrash) ink else paper)
        ink.style = Paint.Style.STROKE
        canvas.drawRect(zone, ink)
        text.textAlign = Paint.Align.CENTER
        text.color = if (overTrash) 0xFFFFFFFF.toInt() else 0xFF000000.toInt()
        canvas.save()
        canvas.rotate(-90f, zone.centerX(), zone.centerY())
        canvas.drawText("Drop here to remove", zone.centerX(), zone.centerY() + text.textSize / 3, text)
        canvas.restore()
        text.color = 0xFF000000.toInt()

        val half = hitSize() / 2
        for (p in pieces) {
            val (x, y) = local(p.x, p.y)
            if (p === dragging) {
                // Hide the piece's old spot while it is being carried.
                canvas.drawRect(x - pieceSize / 2 - 2, y - pieceSize / 2 - 2, x + pieceSize / 2 + 2, y + pieceSize / 2 + 2, paper)
            } else {
                canvas.drawRect(x - half, y - half, x + half, y + half, dashed)
            }
        }
        dragging?.let { Glyphs.draw(canvas, it.kind, dragX, dragY, pieceSize) }
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = e.x
                downY = e.y
                if (done.contains(e.x, e.y)) {
                    pressingDone = true
                    invalidate()
                    return true
                }
                val half = hitSize() / 2
                // Last drawn is on top, so search from the end; nearest wins ties.
                dragging = pieces.asReversed()
                    .filter {
                        val (x, y) = local(it.x, it.y)
                        abs(x - e.x) <= half && abs(y - e.y) <= half
                    }
                    .minByOrNull {
                        val (x, y) = local(it.x, it.y)
                        hypot(x - e.x, y - e.y)
                    }
                dragX = e.x
                dragY = e.y
                invalidate()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (dragging != null) {
                    dragX = e.x
                    dragY = e.y
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                if (pressingDone) {
                    pressingDone = false
                    invalidate()
                    if (done.contains(e.x, e.y)) listener.onDone()
                    return true
                }
                val piece = dragging ?: return true
                dragging = null
                val (tx, ty) = local(trash.left, trash.top)
                val zone = RectF(tx, ty, tx + trash.width(), ty + trash.height())
                when {
                    zone.contains(e.x, e.y) -> {
                        pieces.remove(piece)
                        listener.onPieceRemoved(piece.id)
                    }
                    hypot(e.x - downX, e.y - downY) > slop -> {
                        piece.x = e.rawX
                        piece.y = e.rawY
                        listener.onPieceMoved(piece.id, e.rawX, e.rawY, e.getToolType(0))
                    }
                }
                invalidate()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                dragging = null
                pressingDone = false
                invalidate()
                return true
            }
        }
        return super.onTouchEvent(e)
    }
}
