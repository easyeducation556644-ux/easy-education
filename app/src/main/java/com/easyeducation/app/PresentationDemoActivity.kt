package com.easyeducation.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

class PresentationDemoActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { PresentationDemoApp() } }
    }
}

private data class DemoClass(val title: String)
private data class DemoChapter(val title: String, val classes: List<DemoClass>)
private data class DemoSubject(val title: String, val chapters: List<DemoChapter>)
private data class DemoCourse(val title: String, val subjects: List<DemoSubject>)

private sealed interface DemoScreen {
    data object Courses : DemoScreen
    data class Subjects(val course: DemoCourse) : DemoScreen
    data class Chapters(val course: DemoCourse, val subject: DemoSubject) : DemoScreen
    data class Classes(val course: DemoCourse, val subject: DemoSubject, val chapter: DemoChapter) : DemoScreen
    data class ClassDetails(val course: DemoCourse, val subject: DemoSubject, val chapter: DemoChapter, val item: DemoClass) : DemoScreen
}

private val demoCourses = listOf(
    DemoCourse(
        "Admission Master Course",
        listOf(
            DemoSubject("Bangla", listOf(
                DemoChapter("Grammar", listOf(DemoClass("Parts of Speech"), DemoClass("Sentence & Transformation"))),
                DemoChapter("Literature", listOf(DemoClass("Poetry Basics"), DemoClass("Prose Analysis")))
            )),
            DemoSubject("English", listOf(
                DemoChapter("Grammar", listOf(DemoClass("Tense"), DemoClass("Voice"))),
                DemoChapter("Vocabulary", listOf(DemoClass("Synonym & Antonym"), DemoClass("Idioms")))
            ))
        )
    ),
    DemoCourse(
        "University A Unit Preparation",
        listOf(
            DemoSubject("Physics", listOf(
                DemoChapter("Mechanics", listOf(DemoClass("Motion"), DemoClass("Newton's Laws"))),
                DemoChapter("Waves", listOf(DemoClass("SHM"), DemoClass("Sound")))
            )),
            DemoSubject("Chemistry", listOf(
                DemoChapter("Physical Chemistry", listOf(DemoClass("Mole Concept"), DemoClass("Thermochemistry"))),
                DemoChapter("Organic Chemistry", listOf(DemoClass("Hydrocarbons"), DemoClass("Functional Groups")))
            ))
        )
    ),
    DemoCourse(
        "University B Unit Preparation",
        listOf(
            DemoSubject("General Knowledge", listOf(
                DemoChapter("Bangladesh Affairs", listOf(DemoClass("History"), DemoClass("Constitution"))),
                DemoChapter("International Affairs", listOf(DemoClass("Organizations"), DemoClass("Current World")))
            )),
            DemoSubject("English", listOf(
                DemoChapter("Reading", listOf(DemoClass("Comprehension"), DemoClass("Critical Reading"))),
                DemoChapter("Writing", listOf(DemoClass("Sentence Correction"), DemoClass("Usage")))
            ))
        )
    ),
    DemoCourse(
        "Medical Admission Preparation",
        listOf(
            DemoSubject("Biology", listOf(
                DemoChapter("Cell Biology", listOf(DemoClass("Cell Structure"), DemoClass("Cell Division"))),
                DemoChapter("Human Physiology", listOf(DemoClass("Circulation"), DemoClass("Respiration")))
            )),
            DemoSubject("Chemistry", listOf(
                DemoChapter("Inorganic", listOf(DemoClass("Periodic Table"), DemoClass("Chemical Bonding"))),
                DemoChapter("Organic", listOf(DemoClass("Biomolecules"), DemoClass("Reactions")))
            ))
        )
    )
)

@Composable
private fun PresentationDemoApp() {
    var screen: DemoScreen by remember { mutableStateOf(DemoScreen.Courses) }

    fun back() {
        screen = when (val s = screen) {
            DemoScreen.Courses -> DemoScreen.Courses
            is DemoScreen.Subjects -> DemoScreen.Courses
            is DemoScreen.Chapters -> DemoScreen.Subjects(s.course)
            is DemoScreen.Classes -> DemoScreen.Chapters(s.course, s.subject)
            is DemoScreen.ClassDetails -> DemoScreen.Classes(s.course, s.subject, s.chapter)
        }
    }

    val title = when (val s = screen) {
        DemoScreen.Courses -> "All Courses"
        is DemoScreen.Subjects -> s.course.title
        is DemoScreen.Chapters -> s.subject.title
        is DemoScreen.Classes -> s.chapter.title
        is DemoScreen.ClassDetails -> s.item.title
    }

    DemoScaffold(
        title = title,
        canGoBack = screen !is DemoScreen.Courses,
        onBack = ::back
    ) {
        when (val s = screen) {
            DemoScreen.Courses -> DemoList(
                subtitle = "Presentation Mode • All courses available",
                items = demoCourses.map { it.title },
                onClick = { index -> screen = DemoScreen.Subjects(demoCourses[index]) }
            )
            is DemoScreen.Subjects -> DemoList(
                subtitle = "Subjects",
                items = s.course.subjects.map { it.title },
                onClick = { index -> screen = DemoScreen.Chapters(s.course, s.course.subjects[index]) }
            )
            is DemoScreen.Chapters -> DemoList(
                subtitle = "Chapters",
                items = s.subject.chapters.map { it.title },
                onClick = { index -> screen = DemoScreen.Classes(s.course, s.subject, s.subject.chapters[index]) }
            )
            is DemoScreen.Classes -> DemoList(
                subtitle = "Classes",
                items = s.chapter.classes.map { it.title },
                onClick = { index -> screen = DemoScreen.ClassDetails(s.course, s.subject, s.chapter, s.chapter.classes[index]) }
            )
            is DemoScreen.ClassDetails -> ClassDetailsScreen(s)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DemoScaffold(
    title: String,
    canGoBack: Boolean,
    onBack: () -> Unit,
    content: @Composable () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    if (canGoBack) {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
        ) {
            content()
        }
    }
}

@Composable
private fun DemoList(subtitle: String, items: List<String>, onClick: (Int) -> Unit) {
    Text(subtitle, style = MaterialTheme.typography.bodyMedium)
    Spacer(Modifier.height(12.dp))
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(items.indices.toList()) { index ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onClick(index) }
            ) {
                Row(Modifier.fillMaxWidth().padding(18.dp)) {
                    Text(items[index], style = MaterialTheme.typography.titleMedium)
                }
            }
        }
    }
}

@Composable
private fun ClassDetailsScreen(screen: DemoScreen.ClassDetails) {
    Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text("Course", style = MaterialTheme.typography.labelMedium)
        Text(screen.course.title, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(12.dp))
        Text("Subject / Chapter", style = MaterialTheme.typography.labelMedium)
        Text("${screen.subject.title} • ${screen.chapter.title}")
        Spacer(Modifier.height(20.dp))
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp)) {
                Text("Class available", fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                Text("Video playback is intentionally disabled in this presentation build.")
            }
        }
    }
}
