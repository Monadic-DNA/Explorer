package com.monadicdna.explorer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Renders the Markdown that model replies use: headings, bullet and numbered lists, bold, italic and
 * inline code. Anything else is shown as plain text.
 */
@Composable fun MarkdownText(markdown: String, modifier: Modifier=Modifier) {
    Column(modifier,verticalArrangement=Arrangement.spacedBy(6.dp)) {
        for(line in markdown.lines()) {
            val trimmed=line.trim()
            val heading=Regex("^(#{1,6})\\s+(.*)$").find(trimmed)
            val bullet=Regex("^[*+-]\\s+(.*)$").find(trimmed)
            val numbered=Regex("^(\\d+[.)])\\s+(.*)$").find(trimmed)
            when {
                trimmed.isEmpty() -> {}
                Regex("^(-{3,}|\\*{3,}|_{3,})$").matches(trimmed) -> {}
                heading!=null -> Text(inline(heading.groupValues[2]),style=if(heading.groupValues[1].length<=2)MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleMedium,fontWeight=FontWeight.Bold,modifier=Modifier.padding(top=6.dp))
                bullet!=null -> ListItem("•",bullet.groupValues[1],indent=line.length-line.trimStart().length)
                numbered!=null -> ListItem(numbered.groupValues[1],numbered.groupValues[2],indent=line.length-line.trimStart().length)
                else -> Text(inline(trimmed),style=MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

@Composable private fun ListItem(marker: String, text: String, indent: Int) {
    Row(Modifier.padding(start=(8+indent*6).dp)) {
        Text(marker,style=MaterialTheme.typography.bodyLarge,modifier=Modifier.width(24.dp))
        Text(inline(text),style=MaterialTheme.typography.bodyLarge)
    }
}

/** Bold (`**x**`, `__x__`), italic (`*x*`, `_x_`) and inline code; unmatched markers stay as typed. */
internal fun inline(text: String): AnnotatedString = buildAnnotatedString {
    val pattern=Regex("""\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\*(?!\s)(.+?)(?<!\s)\*|(?<![\w])_(?!\s)(.+?)(?<!\s)_(?![\w])""")
    var index=0
    for(match in pattern.findAll(text)) {
        append(text.substring(index,match.range.first))
        val (bold1,bold2,code,italic1,italic2)=match.destructured
        when {
            bold1.isNotEmpty()||bold2.isNotEmpty() -> { pushStyle(SpanStyle(fontWeight=FontWeight.Bold));append(inline(bold1.ifEmpty{bold2}));pop() }
            code.isNotEmpty() -> { pushStyle(SpanStyle(fontFamily=FontFamily.Monospace));append(code);pop() }
            else -> { pushStyle(SpanStyle(fontStyle=FontStyle.Italic));append(inline(italic1.ifEmpty{italic2}));pop() }
        }
        index=match.range.last+1
    }
    append(text.substring(index))
}
