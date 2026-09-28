package com.snsoccer.palette

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path

/**
 * Draws the four pieces the same way the JS side draws them on the page
 * (src/page/pieceShapes.ts): X and O players, a solid cone, a solid ball,
 * each on a white halo so it stays legible over lines and handwriting.
 */
object Glyphs {
    const val ATTACKER = "attacker"
    const val DEFENDER = "defender"
    const val CONE = "cone"
    const val BALL = "ball"

    val KINDS = listOf(ATTACKER, DEFENDER, CONE, BALL)

    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF000000.toInt() }
    private val paper = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt() }

    /** Draw `kind` centred on (cx, cy), `size` pixels across. */
    fun draw(canvas: Canvas, kind: String, cx: Float, cy: Float, size: Float) {
        val stroke = maxOf(4f, size * 0.17f)
        val halo = maxOf(2f, size * 0.07f)
        when (kind) {
            ATTACKER -> {
                val h = size * 0.4f
                for ((p, w) in listOf(paper to stroke + 2 * halo, ink to stroke)) {
                    p.style = Paint.Style.STROKE
                    p.strokeWidth = w
                    p.strokeCap = Paint.Cap.ROUND
                    canvas.drawLine(cx - h, cy - h, cx + h, cy + h, p)
                    canvas.drawLine(cx - h, cy + h, cx + h, cy - h, p)
                }
            }
            DEFENDER -> {
                val r = size * 0.42f
                paper.style = Paint.Style.FILL
                canvas.drawCircle(cx, cy, r + halo, paper)
                ink.style = Paint.Style.STROKE
                ink.strokeWidth = stroke
                canvas.drawCircle(cx, cy, r - stroke / 2, ink)
            }
            CONE -> {
                val w = size * 0.8f
                val hgt = size * 0.78f
                paper.style = Paint.Style.FILL
                canvas.drawPath(triangle(cx, cy, w + 3 * halo, hgt + 3 * halo), paper)
                ink.style = Paint.Style.FILL
                canvas.drawPath(triangle(cx, cy, w, hgt), ink)
            }
            BALL -> {
                val r = size * 0.26f
                paper.style = Paint.Style.FILL
                canvas.drawCircle(cx, cy, r + halo, paper)
                ink.style = Paint.Style.FILL
                canvas.drawCircle(cx, cy, r, ink)
            }
        }
    }

    /**
     * The plugin's icon, a small pitch: outline, halfway line, centre circle
     * and the two goal boxes. Drawn as vectors so it stays crisp at any size.
     */
    fun drawPitchIcon(canvas: Canvas, cx: Float, cy: Float, size: Float, color: Int) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.STROKE
            strokeWidth = maxOf(2f, size * 0.07f)
        }
        val w = size * 0.62f
        val h = size * 0.86f
        val l = cx - w / 2
        val t = cy - h / 2
        canvas.drawRect(l, t, l + w, t + h, p)
        canvas.drawLine(l, cy, l + w, cy, p)
        canvas.drawCircle(cx, cy, w * 0.2f, p)
        val bw = w * 0.5f
        val bh = h * 0.14f
        canvas.drawRect(cx - bw / 2, t, cx + bw / 2, t + bh, p)
        canvas.drawRect(cx - bw / 2, t + h - bh, cx + bw / 2, t + h, p)
    }

    private fun triangle(cx: Float, cy: Float, w: Float, h: Float): Path =
        Path().apply {
            moveTo(cx, cy - h / 2)
            lineTo(cx + w / 2, cy + h / 2)
            lineTo(cx - w / 2, cy + h / 2)
            close()
        }
}
