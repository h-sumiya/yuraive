package com.yuraive.player.ui

import com.yuraive.player.model.ValidationIssue
import com.yuraive.player.model.YuraiveLayout
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ButtonLayoutDocumentTest {
    @Test
    fun keepsSupportedLayoutMarkupAndRemovesExecutableMarkup() {
        val source =
            """
            <style>.stage { display: grid }</style>
            <script>alert('no')</script>
            <div class="stage" onclick="alert(1)">
              <slot id="actions" data-extra="removed"></slot>
              <slot></slot>
              <img src="https://example.com/tracker.png">
            </div>
            """
                .trimIndent()

        val (css, body) = YuraiveLayout.sanitize(source)
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
        val document =
            YuraiveLayout.buildDocument("<style>.yuraive-button{color:red}</style><slot></slot>")
        assertTrue(document.contains(".yuraive-button{all:unset"))
        assertTrue(document.contains(".yuraive-button{color:red}"))
        assertFalse(document.contains("#574de5"))
    }

    @Test
    fun validatesDefaultAndDuplicateSlots() {
        assertTrue(
            YuraiveLayout.validate("<style></style><slot name=\"actions\"></slot>").any {
                it.severity == ValidationIssue.Severity.ERROR
            }
        )
        val valid =
            YuraiveLayout.validate("<style></style><slot id=\"actions\"></slot><slot></slot>")
        assertTrue(valid.isEmpty())
        assertTrue(
            YuraiveLayout.validate("<style></style><slot></slot><slot></slot>").any {
                it.message.contains("重複")
            }
        )
    }

    @Test
    fun acceptsOnlyBrandedLayoutExtension() {
        assertTrue(YuraiveLayout.hasExpectedExtension("layouts/player.yuraive-layout.html"))
        assertTrue(YuraiveLayout.hasExpectedExtension("layouts/PLAYER.YURAIVE-LAYOUT.HTML"))
        assertFalse(YuraiveLayout.hasExpectedExtension("layouts/player.html"))
    }
}
