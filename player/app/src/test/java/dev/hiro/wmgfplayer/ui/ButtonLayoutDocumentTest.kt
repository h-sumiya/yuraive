package dev.hiro.wmgfplayer.ui

import dev.hiro.wmgfplayer.model.WmgLayout
import dev.hiro.wmgfplayer.model.ValidationIssue
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ButtonLayoutDocumentTest {
    @Test
    fun keepsSupportedLayoutMarkupAndRemovesExecutableMarkup() {
        val source = """
            <style>.stage { display: grid }</style>
            <script>alert('no')</script>
            <div class="stage" onclick="alert(1)">
              <slot id="actions" data-extra="removed"></slot>
              <slot></slot>
              <img src="https://example.com/tracker.png">
            </div>
        """.trimIndent()

        val (css, body) = WmgLayout.sanitize(source)
        assertTrue(css.contains("display: grid"))
        assertTrue(body.contains("<div class=\"stage\">"))
        assertTrue(body.contains("<slot id=\"actions\">"))
        assertFalse(body.contains("onclick"))
        assertFalse(body.contains("data-extra"))
        assertFalse(body.contains("<script"))
        assertFalse(body.contains("<img"))
    }

    @Test
    fun playerDocumentContainsOnlyAResetBeforeAuthorStyles() {
        val document = WmgLayout.buildDocument("<style>.wmg-button{color:red}</style><slot></slot>")
        assertTrue(document.contains(".wmg-button{all:unset"))
        assertTrue(document.contains(".wmg-button{color:red}"))
        assertFalse(document.contains("#702BC4"))
    }

    @Test
    fun validatesDefaultAndDuplicateSlots() {
        assertTrue(WmgLayout.validate("<style></style><slot name=\"actions\"></slot>").any { it.severity == ValidationIssue.Severity.ERROR })
        val valid = WmgLayout.validate("<style></style><slot id=\"actions\"></slot><slot></slot>")
        assertTrue(valid.isEmpty())
        assertTrue(WmgLayout.validate("<style></style><slot></slot><slot></slot>").any { it.message.contains("重複") })
    }
}
