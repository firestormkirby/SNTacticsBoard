package com.tacticsboard.palette

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF

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

    const val SAVE = "save"
    const val LOAD = "load"
    const val COPY = "copy"
    const val RESET = "reset"
    const val TRASH = "trash"

    /** The page's actions under the pieces; the trash has its own row. */
    val PAGE_ACTIONS = listOf(SAVE, LOAD, COPY, RESET)

    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    /**
     * An action's icon centred on (cx, cy), `size` pixels across: a disk
     * (save), a folder (load), two pages (copy), a circling arrow (reset), a
     * bin (trash). Line
     * drawings on a 24-unit grid, the same paths as the preview's SVGs.
     */
    fun drawAction(canvas: Canvas, action: String, cx: Float, cy: Float, size: Float, color: Int) {
        val u = size / 24f
        val path = Path()
        fun m(x: Float, y: Float) = path.moveTo(cx + (x - 12) * u, cy + (y - 12) * u)
        fun l(x: Float, y: Float) = path.lineTo(cx + (x - 12) * u, cy + (y - 12) * u)
        when (action) {
            SAVE -> {
                m(4f, 3f); l(17f, 3f); l(20f, 6f); l(20f, 21f); l(4f, 21f); path.close()
                m(8f, 3f); l(8f, 8f); l(16f, 8f); l(16f, 3f)
                m(7f, 13f); l(17f, 13f); l(17f, 21f); l(7f, 21f); path.close()
            }
            LOAD -> {
                m(3f, 6f); l(10f, 6f); l(12f, 8f); l(21f, 8f); l(21f, 20f); l(3f, 20f); path.close()
                m(3f, 11f); l(21f, 11f)
            }
            COPY -> {
                m(9f, 7f); l(20f, 7f); l(20f, 21f); l(9f, 21f); path.close()
                m(15f, 7f); l(15f, 3f); l(4f, 3f); l(4f, 17f); l(9f, 17f)
            }
            RESET -> {
                val r = 7.5f * u
                path.addArc(RectF(cx - r, cy + u - r, cx + r, cy + u + r), 0f, 310f)
                m(18f, 2.5f); l(18f, 7f); l(13.5f, 7f)
            }
            TRASH -> {
                m(4f, 7f); l(20f, 7f)
                m(9.5f, 7f); l(9.5f, 4f); l(14.5f, 4f); l(14.5f, 7f)
                m(6.5f, 7f); l(7.5f, 20f); l(16.5f, 20f); l(17.5f, 7f)
                m(10.5f, 11f); l(10.5f, 16.5f)
                m(13.5f, 11f); l(13.5f, 16.5f)
            }
        }
        line.color = color
        line.strokeWidth = maxOf(1.5f, 2.2f * u)
        canvas.drawPath(path, line)
    }

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

    /** An hourglass, for "working": two triangles tip to tip, with caps. */
    fun drawHourglass(canvas: Canvas, cx: Float, cy: Float, size: Float, color: Int) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.STROKE
            strokeWidth = maxOf(2f, size * 0.08f)
            strokeJoin = Paint.Join.ROUND
            strokeCap = Paint.Cap.ROUND
        }
        val w = size * 0.42f
        val h = size * 0.56f
        val top = cy - h / 2
        val bottom = cy + h / 2
        canvas.drawLine(cx - w / 2 - size * 0.06f, top, cx + w / 2 + size * 0.06f, top, p)
        canvas.drawLine(cx - w / 2 - size * 0.06f, bottom, cx + w / 2 + size * 0.06f, bottom, p)
        val glass = Path().apply {
            moveTo(cx - w / 2, top)
            lineTo(cx + w / 2, top)
            lineTo(cx, cy)
            lineTo(cx + w / 2, bottom)
            lineTo(cx - w / 2, bottom)
            lineTo(cx, cy)
            close()
        }
        canvas.drawPath(glass, p)
        // The sand, run mostly through.
        p.style = Paint.Style.FILL
        canvas.drawPath(Path().apply {
            moveTo(cx, bottom - h * 0.22f)
            lineTo(cx + w * 0.3f, bottom)
            lineTo(cx - w * 0.3f, bottom)
            close()
        }, p)
    }

    private fun triangle(cx: Float, cy: Float, w: Float, h: Float): Path =
        Path().apply {
            moveTo(cx, cy - h / 2)
            lineTo(cx + w / 2, cy + h / 2)
            lineTo(cx - w / 2, cy + h / 2)
            close()
        }
}
