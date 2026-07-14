package dev.hiro.wmgfplayer.playback

import dev.hiro.wmgfplayer.model.WmgJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PlaybackStatsValidationTest {
    @Test
    fun validatesDisplayDslAndShareData() {
        val display = WmgJson.format.parseToJsonElement(
            """{
              "schemaVersion":1,
              "fallbackText":"Sランク",
              "root":{"type":"column","style":{"padding":12,"gap":8},"children":[
                {"type":"text","spans":[{"text":"S","style":{"fontSize":64,"fontWeight":800}},{"text":" RANK"}]},
                {"type":"progress","value":0.8,"label":"安眠度"}
              ]}
            }""",
        ).jsonObject
        val result = DisplayValidator.validate(display)
        assertEquals("Sランク", result.fallbackText)
        assertEquals(2, result.root.children.size)

        val share = ShareValidator.validate(
            WmgJson.format.parseToJsonElement(
                """{"text":"Sランクでした","url":"https://example.com","hashtags":["WMGF"],"via":"author_1"}""",
            ).jsonObject,
        )
        assertEquals("Sランクでした\nhttps://example.com\n#WMGF\n@author_1", share.composedText())
    }

    @Test
    fun rejectsUnsafeDisplayImagesAndShareUrls() {
        val display = WmgJson.format.parseToJsonElement(
            """{"schemaVersion":1,"fallbackText":"fallback","root":{"type":"image","source":"https://example.com/a.png"}}""",
        ).jsonObject
        assertThrows(IllegalArgumentException::class.java) { DisplayValidator.validate(display) }

        val share = WmgJson.format.parseToJsonElement(
            """{"text":"share","url":"http://example.com"}""",
        ).jsonObject
        assertThrows(IllegalArgumentException::class.java) { ShareValidator.validate(share) }
    }

    @Test
    fun rejectsInvalidDisplayStructureAndDimensions() {
        val spansOnBadge = WmgJson.format.parseToJsonElement(
            """{"schemaVersion":1,"fallbackText":"fallback","root":{"type":"badge","text":"badge","spans":[]}}""",
        ).jsonObject
        assertThrows(IllegalArgumentException::class.java) { DisplayValidator.validate(spansOnBadge) }

        val objectWidth = WmgJson.format.parseToJsonElement(
            """{"schemaVersion":1,"fallbackText":"fallback","root":{"type":"spacer","style":{"width":{}}}}""",
        ).jsonObject
        assertThrows(IllegalStateException::class.java) { DisplayValidator.validate(objectWidth) }
    }
}
