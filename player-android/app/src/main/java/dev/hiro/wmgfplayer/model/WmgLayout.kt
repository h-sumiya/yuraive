package dev.hiro.wmgfplayer.model

data class WmgLayoutIssue(val severity: ValidationIssue.Severity, val message: String)

object WmgLayout {
    private val styleElement = Regex("""(?is)<style(?:\s[^>]*)?>(.*?)</style\s*>""")
    private val element = Regex("""(?is)<\s*(/?)\s*([a-z][a-z0-9-]*)([^>]*)>""")
    private val attribute = Regex("""(?is)\b(class|id|name|style|role|aria-label)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)""")
    private val allowedElements = setOf("div", "slot")

    fun sanitize(source: String): Pair<String, String> {
        val css = styleElement.findAll(source).joinToString("\n") { it.groupValues[1] }
        val withoutStyles = source.replace(styleElement, "")
        val body = element.replace(withoutStyles) { match ->
            val closing = match.groupValues[1].isNotEmpty()
            val name = match.groupValues[2].lowercase()
            if (name !in allowedElements) "" else if (closing) "</$name>" else {
                val attributes = attribute.findAll(match.groupValues[3]).joinToString(" ") { it.value.trim() }
                if (attributes.isEmpty()) "<$name>" else "<$name $attributes>"
            }
        }
        return css to body
    }

    fun validate(source: String): List<WmgLayoutIssue> {
        val slots = slotIdentifiers(source)
        val issues = mutableListOf<WmgLayoutIssue>()
        if (slots.count(String::isEmpty) != 1) {
            issues += WmgLayoutIssue(ValidationIssue.Severity.ERROR, "name/idのないデフォルトslotが1件必要です")
        }
        val duplicates = slots.groupingBy { it }.eachCount().filterValues { it > 1 }.keys
        if (duplicates.isNotEmpty()) {
            issues += WmgLayoutIssue(ValidationIssue.Severity.ERROR, "slot識別子が重複しています: ${duplicates.joinToString { it.ifEmpty { "(default)" } }}")
        }
        if (!styleElement.containsMatchIn(source)) {
            issues += WmgLayoutIssue(ValidationIssue.Severity.WARNING, "style要素がありません。ボタンには暗黙の外観が適用されません")
        }
        return issues
    }

    fun slotIdentifiers(source: String): List<String> {
        val (_, body) = sanitize(source)
        return element.findAll(body).filter { it.groupValues[1].isEmpty() && it.groupValues[2].equals("slot", true) }.map { match ->
            val attributes = attribute.findAll(match.groupValues[3]).associate { attributeMatch ->
                val raw = attributeMatch.groupValues[2]
                attributeMatch.groupValues[1].lowercase() to raw.removeSurrounding("\"").removeSurrounding("'").trim()
            }
            attributes["name"] ?: attributes["id"].orEmpty()
        }.toList()
    }

    fun buildDocument(source: String): String {
        val (css, body) = sanitize(source)
        return """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: content:">
<style>
html,body,#wmg-layout-root{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}
html{container:wmg-canvas / size}
*,*::before,*::after{box-sizing:border-box}
.wmg-button{all:unset;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
</style><style>$css</style></head><body><div id="wmg-layout-root">$body</div></body></html>"""
    }
}
