package com.easyeducation.app

import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun NativeEdgeCourseHomeBlock(nav: NavHostController) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable { nav.navigate("edgecourse") },
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Row(
            modifier = Modifier.padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surface) {
                Icon(
                    Icons.Default.School,
                    contentDescription = null,
                    modifier = Modifier.padding(14.dp).size(30.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("EdgeCourse Library", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.width(8.dp))
                    EdgeAccessBadge("FREE")
                }
                Spacer(Modifier.height(3.dp))
                Text(
                    "All courses open • classes, videos & materials",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.76f),
                )
            }
            Text("›", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun NativeEdgeCourseCatalogScreen(nav: NavHostController) {
    val context = LocalContext.current
    val repository = remember { NativeEdgeCourseRepository(context.applicationContext) }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var searchText by rememberSaveable { mutableStateOf("") }
    var submittedSearch by rememberSaveable { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var catalog by remember { mutableStateOf(NativeEdgeCatalog()) }

    LaunchedEffect(page, submittedSearch) {
        loading = true
        error = null
        runCatching { withContext(Dispatchers.IO) { repository.catalog(page, submittedSearch) } }
            .onSuccess { catalog = it }
            .onFailure { error = it.message ?: "EdgeCourse courses could not be loaded" }
        loading = false
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Spacer(Modifier.height(4.dp)) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                Column(Modifier.weight(1f)) {
                    Text("EdgeCourse", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                    Text("Free learning library", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                EdgeAccessBadge(if (catalog.accessMode == "free") "FREE" else "PREMIUM READY")
            }
        }
        item {
            Card(
                shape = RoundedCornerShape(22.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text("Everything from EdgeCourse, arranged for Easy Education", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Every course is open right now. The access layer is already premium-ready, so selected courses can be locked later without rebuilding this section.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.78f),
                    )
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = searchText,
                    onValueChange = { searchText = it },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    label = { Text("Search courses") },
                )
                Button(onClick = { submittedSearch = searchText.trim(); page = 1 }) { Text("Search") }
            }
        }
        if (loading) {
            item { Box(Modifier.fillMaxWidth().padding(36.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
        } else if (error != null) {
            item { EdgeMessageCard(error.orEmpty()) }
        } else {
            item {
                Text(
                    if (submittedSearch.isBlank()) "${catalog.count} courses" else "${catalog.count} results for “$submittedSearch”",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
            items(catalog.courses, key = { it.id }) { course ->
                EdgeCourseCard(course) { nav.navigate("edgecourse/${Uri.encode(course.id)}") }
            }
            if (catalog.courses.isEmpty()) item { EdgeMessageCard("No EdgeCourse course matched this search.") }
            if (catalog.totalPages > 1) {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedButton(onClick = { if (page > 1) page -= 1 }, enabled = page > 1) { Text("Previous") }
                        Text("Page ${catalog.page} / ${catalog.totalPages}", fontWeight = FontWeight.Bold)
                        OutlinedButton(onClick = { if (page < catalog.totalPages) page += 1 }, enabled = page < catalog.totalPages) { Text("Next") }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
private fun EdgeCourseCard(course: NativeEdgeCourse, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(enabled = course.hasAccess, onClick = onClick),
        shape = RoundedCornerShape(22.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(13.dp)) {
            AsyncImage(
                model = course.thumbnailUrl,
                contentDescription = course.title,
                modifier = Modifier.size(width = 116.dp, height = 82.dp).clip(RoundedCornerShape(16.dp)),
                contentScale = ContentScale.Crop,
            )
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    EdgeAccessBadge(if (course.hasAccess && course.accessType == "free") "FREE" else if (course.hasAccess) "OPEN" else "LOCKED")
                    Spacer(Modifier.width(7.dp))
                    Text("Course #${course.id}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.height(6.dp))
                Text(course.title, fontWeight = FontWeight.ExtraBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (course.description.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(course.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
fun NativeEdgeCourseDetailScreen(nav: NavHostController, courseId: String) {
    val context = LocalContext.current
    val repository = remember { NativeEdgeCourseRepository(context.applicationContext) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var detail by remember { mutableStateOf<NativeEdgeCourseDetail?>(null) }

    LaunchedEffect(courseId) {
        loading = true
        error = null
        runCatching { withContext(Dispatchers.IO) { repository.course(courseId) } }
            .onSuccess { detail = it }
            .onFailure { error = it.message ?: "EdgeCourse detail could not be loaded" }
        loading = false
    }

    if (loading) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    if (detail == null) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            EdgeMessageCard(error ?: "Course could not be loaded")
        }
        return
    }

    val data = detail!!
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Spacer(Modifier.height(4.dp)) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Text("EdgeCourse", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
                EdgeAccessBadge(if (data.course.hasAccess && data.course.accessType == "free") "FREE ACCESS" else if (data.course.hasAccess) "ACCESS" else "LOCKED")
            }
        }
        item { EdgeCourseHero(data) }
        if (!data.course.hasAccess) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Lock, null)
                        Spacer(Modifier.width(10.dp))
                        Text("This course is configured as premium. Access can be granted through EdgeCourse entitlements.")
                    }
                }
            }
        }
        if (data.headers.isEmpty()) item { EdgeMessageCard("No section headers are available for this course yet.") }
        else items(data.headers, key = { it.id }) { header -> EdgeHeaderBlock(header, data.course) }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
private fun EdgeCourseHero(detail: NativeEdgeCourseDetail) {
    val course = detail.course
    Card(shape = RoundedCornerShape(26.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column {
            if (course.thumbnailUrl.isNotBlank()) {
                AsyncImage(model = course.thumbnailUrl, contentDescription = course.title, modifier = Modifier.fillMaxWidth().height(190.dp), contentScale = ContentScale.Crop)
            }
            Column(Modifier.padding(18.dp)) {
                Text("EDGECOURSE • COURSE #${course.id}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(6.dp))
                Text(course.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                if (course.description.isNotBlank()) { Spacer(Modifier.height(8.dp)); Text(course.description, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) { EdgeMetric("Headers", detail.counts.headers); EdgeMetric("Sections", detail.counts.sections); EdgeMetric("Modules", detail.counts.modules) }
                Spacer(Modifier.height(7.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) { EdgeMetric("Items", detail.counts.items); EdgeMetric("Video", detail.counts.videos); EdgeMetric("Material", detail.counts.materials) }
            }
        }
    }
}

@Composable
private fun EdgeMetric(label: String, value: Int) {
    Surface(shape = RoundedCornerShape(999.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
        Text("$label $value", Modifier.padding(horizontal = 10.dp, vertical = 6.dp), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun EdgeHeaderBlock(header: NativeEdgeHeader, course: NativeEdgeCourse) {
    var expanded by rememberSaveable(header.id) { mutableStateOf(true) }
    Card(
        modifier = Modifier.fillMaxWidth().animateContentSize(),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column {
            Row(modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = RoundedCornerShape(11.dp), color = MaterialTheme.colorScheme.primary) {
                    Text("${header.sections.size}", Modifier.padding(horizontal = 9.dp, vertical = 6.dp), color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.ExtraBold)
                }
                Spacer(Modifier.width(10.dp))
                Text(header.title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                Text(if (expanded) "⌃" else "⌄", fontWeight = FontWeight.Bold)
            }
            AnimatedVisibility(expanded) {
                Column(Modifier.padding(start = 10.dp, end = 10.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    if (header.sections.isEmpty()) EdgeMessageCard("No sections in this part.")
                    header.sections.forEach { section -> EdgeSectionBlock(section, course) }
                }
            }
        }
    }
}

@Composable
private fun EdgeSectionBlock(section: NativeEdgeSection, course: NativeEdgeCourse) {
    var expanded by rememberSaveable(section.id) { mutableStateOf(false) }
    val groups = section.modules.size + if (section.materials.isNotEmpty()) 1 else 0
    Surface(modifier = Modifier.fillMaxWidth().animateContentSize(), shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)) {
        Column {
            Row(Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(section.title, fontWeight = FontWeight.ExtraBold)
                    Text("$groups groups", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(if (expanded) "−" else "+", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            AnimatedVisibility(expanded) {
                Column(Modifier.padding(start = 10.dp, end = 10.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    section.modules.forEach { EdgeModuleBlock(it, course) }
                    if (section.materials.isNotEmpty()) EdgeModuleBlock(NativeEdgeModule("materials-${section.id}", "Section materials", section.materials), course)
                    if (section.modules.isEmpty() && section.materials.isEmpty()) EdgeMessageCard("No content inside this section.")
                }
            }
        }
    }
}

@Composable
private fun EdgeModuleBlock(module: NativeEdgeModule, course: NativeEdgeCourse) {
    var expanded by rememberSaveable(module.id) { mutableStateOf(false) }
    Surface(
        modifier = Modifier.fillMaxWidth().animateContentSize(),
        shape = RoundedCornerShape(15.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column {
            Row(Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(module.title, fontWeight = FontWeight.Bold)
                    Text("${module.items.size} items", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(if (expanded) "Hide" else "Show", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            }
            AnimatedVisibility(expanded) {
                Column(Modifier.padding(start = 9.dp, end = 9.dp, bottom = 9.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    module.items.forEach { EdgeItemCard(it, course) }
                    if (module.items.isEmpty()) EdgeMessageCard("No items in this module.")
                }
            }
        }
    }
}

@Composable
private fun EdgeItemCard(item: NativeEdgeItem, course: NativeEdgeCourse) {
    val context = LocalContext.current
    Surface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f)) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (item.locked) Icons.Default.Lock else Icons.Default.PlayArrow, null, Modifier.size(19.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(item.title, fontWeight = FontWeight.Bold)
                    Text(item.kind.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (item.description.isNotBlank()) { Spacer(Modifier.height(6.dp)); Text(item.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (item.locked) {
                Spacer(Modifier.height(7.dp)); Text("Premium access required", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
            } else if (item.links.isEmpty()) {
                Spacer(Modifier.height(7.dp)); Text("Listed by EdgeCourse, but no usable link is currently attached.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Spacer(Modifier.height(9.dp))
                item.links.forEach { link ->
                    OutlinedButton(
                        onClick = {
                            if (link.playable || link.kind == "video") NativeEdgeCoursePlayerActivity.open(context, course.id, item.title, link.url)
                            else NativeResourceViewerActivity.open(context, "${item.title} • ${link.label}", link.url)
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (link.kind == "video") "▶ ${link.label}" else link.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
private fun EdgeAccessBadge(text: String) {
    Surface(shape = RoundedCornerShape(999.dp), color = MaterialTheme.colorScheme.primary) {
        Text(text, Modifier.padding(horizontal = 9.dp, vertical = 4.dp), color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
private fun EdgeMessageCard(message: String) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
        Text(message, Modifier.fillMaxWidth().padding(14.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
