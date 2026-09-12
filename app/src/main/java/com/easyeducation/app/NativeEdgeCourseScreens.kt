package com.easyeducation.app

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlayCircle
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
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private enum class EdgePage { HOME, HEADER, SECTION, MODULE, MATERIALS, ITEM, CLASS }
private val EdgeHeroShape = RoundedCornerShape(24.dp)
private val EdgeCardShape = RoundedCornerShape(18.dp)
private val EdgeSmallShape = RoundedCornerShape(14.dp)
private val EdgePillShape = RoundedCornerShape(999.dp)

private data class EdgeClassRef(
    val classId: String,
    val headerId: String,
    val sectionId: String,
    val moduleId: String,
    val headerTitle: String,
    val sectionTitle: String,
    val moduleTitle: String,
    val item: NativeEdgeItem,
    val primaryVideo: NativeEdgeLink,
    val order: Int,
)

@Composable
fun NativeEdgeCourseHomeBlock(nav: NavHostController) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable { nav.navigate("edgecourse") },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        shape = EdgeHeroShape,
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.10f),
                ) {
                    Icon(
                        Icons.Default.School,
                        contentDescription = null,
                        modifier = Modifier.padding(10.dp).size(25.dp),
                        tint = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                Spacer(Modifier.width(11.dp))
                Column(Modifier.weight(1f)) {
                    Text("EdgeCourse", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Text("Classes + study materials", style = MaterialTheme.typography.bodySmall)
                }
                Icon(Icons.Default.ArrowForward, contentDescription = "Open EdgeCourse")
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.PlayCircle, contentDescription = null, modifier = Modifier.size(21.dp))
                Spacer(Modifier.width(8.dp))
                Text("Browse free courses, classes and study materials", style = MaterialTheme.typography.bodySmall)
            }
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
        item {
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { nav.popBackStack() }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
                Column(Modifier.weight(1f)) {
                    Text("EdgeCourse", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                    Text("Classes • Materials • Practice", color = MaterialTheme.colorScheme.onSurfaceVariant)
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
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Courses", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Text("${catalog.count}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        when {
            loading -> item {
                Box(Modifier.fillMaxWidth().height(150.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            }
            error != null -> item { EdgeMessageCard(error.orEmpty()) }
            catalog.courses.isEmpty() -> item { EdgeMessageCard("No EdgeCourse course matched this search.") }
            else -> items(catalog.courses, key = { it.id }) { course ->
                EdgeCourseCard(course) { nav.navigate("edgecourse/${Uri.encode(course.id)}") }
            }
        }
        if (!loading && error == null && catalog.totalPages > 1) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedButton(onClick = { if (page > 1) page -= 1 }, enabled = page > 1) { Text("Previous") }
                    Text("Page ${catalog.page} / ${catalog.totalPages}", fontWeight = FontWeight.Bold)
                    OutlinedButton(
                        onClick = { if (page < catalog.totalPages) page += 1 },
                        enabled = page < catalog.totalPages,
                    ) { Text("Next") }
                }
            }
        }
        item { Spacer(Modifier.height(18.dp)) }
    }
}

@Composable
private fun EdgeCourseCard(course: NativeEdgeCourse, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(
            1.dp,
            if (course.hasAccess) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline,
        ),
        shape = EdgeCardShape,
    ) {
        Column {
            if (course.thumbnailUrl.isNotBlank()) {
                AsyncImage(
                    model = course.thumbnailUrl,
                    contentDescription = course.title,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().aspectRatio(16f / 7f),
                )
            }
            Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    EdgeBadge(if (course.hasAccess && course.accessType == "free") "FREE COURSE" else if (course.hasAccess) "ACCESS ACTIVE" else "LOCKED")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            course.title,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.ExtraBold,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            if (course.hasAccess) "Open access • Classes & materials" else "Curriculum visible • content locked",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Surface(
                        shape = CircleShape,
                        color = if (course.hasAccess) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                    ) {
                        Icon(
                            if (course.hasAccess) Icons.Default.CheckCircle else Icons.Default.Lock,
                            contentDescription = null,
                            modifier = Modifier.padding(9.dp).size(19.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun NativeEdgeCourseDetailScreen(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
) {
    val context = LocalContext.current
    val repository = remember { NativeEdgeCourseRepository(context.applicationContext) }
    var loading by remember(courseId) { mutableStateOf(true) }
    var error by remember(courseId) { mutableStateOf<String?>(null) }
    var detail by remember(courseId) { mutableStateOf<NativeEdgeCourseDetail?>(null) }

    LaunchedEffect(courseId) {
        loading = true
        error = null
        runCatching { withContext(Dispatchers.IO) { repository.course(courseId) } }
            .onSuccess { detail = it }
            .onFailure { error = it.message ?: "EdgeCourse detail could not be loaded" }
        loading = false
    }

    if (loading && detail == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    val data = detail
    if (data == null) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            EdgeBack({ nav.popBackStack() }, "EdgeCourse")
            Spacer(Modifier.height(12.dp))
            EdgeMessageCard(error ?: "Course could not be loaded")
        }
        return
    }

    EdgeCourseExperience(
        nav = nav,
        viewModel = viewModel,
        state = state,
        detail = data,
    )
}

@Composable
private fun EdgeCourseExperience(
    nav: NavHostController,
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    detail: NativeEdgeCourseDetail,
) {
    val course = detail.course
    var pageName by rememberSaveable(course.id) { mutableStateOf(EdgePage.HOME.name) }
    var headerId by rememberSaveable(course.id) { mutableStateOf("") }
    var sectionId by rememberSaveable(course.id) { mutableStateOf("") }
    var moduleId by rememberSaveable(course.id) { mutableStateOf("") }
    var itemId by rememberSaveable(course.id) { mutableStateOf("") }
    var selectedClassId by rememberSaveable(course.id) { mutableStateOf("") }
    var classReturnPage by rememberSaveable(course.id) { mutableStateOf(EdgePage.MODULE.name) }
    var itemReturnPage by rememberSaveable(course.id) { mutableStateOf(EdgePage.MODULE.name) }
    val page = runCatching { EdgePage.valueOf(pageName) }.getOrDefault(EdgePage.HOME)
    val classRefs = remember(detail) { edgeClassRefs(detail) }
    val enrichedState = remember(state, detail, classRefs) { edgeEnrichedState(state, detail, classRefs) }

    BackHandler(enabled = page != EdgePage.HOME && page != EdgePage.CLASS) {
        pageName = when (page) {
            EdgePage.HEADER -> EdgePage.HOME.name
            EdgePage.SECTION -> EdgePage.HEADER.name
            EdgePage.MODULE, EdgePage.MATERIALS -> EdgePage.SECTION.name
            EdgePage.ITEM -> itemReturnPage
            else -> EdgePage.HOME.name
        }
    }

    val selectedHeader = detail.headers.firstOrNull { it.id == headerId }
    val selectedSection = selectedHeader?.sections?.firstOrNull { it.id == sectionId }
    val selectedModule = selectedSection?.modules?.firstOrNull { it.id == moduleId }
    val selectedItem = if (moduleId.isBlank()) {
        selectedSection?.materials?.firstOrNull { it.id == itemId }
    } else {
        selectedModule?.items?.firstOrNull { it.id == itemId }
    }

    when (page) {
        EdgePage.HOME -> EdgeCourseHomePage(nav, detail) { selected ->
            headerId = selected.id
            pageName = EdgePage.HEADER.name
        }
        EdgePage.HEADER -> EdgeHeaderPage(selectedHeader, onBack = { pageName = EdgePage.HOME.name }) { selected ->
            sectionId = selected.id
            pageName = EdgePage.SECTION.name
        }
        EdgePage.SECTION -> EdgeSectionPage(
            section = selectedSection,
            onBack = { pageName = EdgePage.HEADER.name },
            onModule = { selected -> moduleId = selected.id; pageName = EdgePage.MODULE.name },
            onMaterials = { moduleId = ""; pageName = EdgePage.MATERIALS.name },
        )
        EdgePage.MODULE -> EdgeModulePage(
            detail = detail,
            header = selectedHeader,
            section = selectedSection,
            module = selectedModule,
            onBack = { pageName = EdgePage.SECTION.name },
            onItem = { item ->
                itemId = item.id
                val classRef = classRefs.firstOrNull {
                    it.headerId == headerId && it.sectionId == sectionId && it.moduleId == moduleId && it.item.id == item.id
                }
                if (classRef != null) {
                    selectedClassId = classRef.classId
                    classReturnPage = EdgePage.MODULE.name
                    pageName = EdgePage.CLASS.name
                } else {
                    itemReturnPage = EdgePage.MODULE.name
                    pageName = EdgePage.ITEM.name
                }
            },
        )
        EdgePage.MATERIALS -> EdgeMaterialsPage(
            detail = detail,
            header = selectedHeader,
            section = selectedSection,
            onBack = { pageName = EdgePage.SECTION.name },
            onItem = { item ->
                itemId = item.id
                moduleId = ""
                val classRef = classRefs.firstOrNull {
                    it.headerId == headerId && it.sectionId == sectionId && it.moduleId.isBlank() && it.item.id == item.id
                }
                if (classRef != null) {
                    selectedClassId = classRef.classId
                    classReturnPage = EdgePage.MATERIALS.name
                    pageName = EdgePage.CLASS.name
                } else {
                    itemReturnPage = EdgePage.MATERIALS.name
                    pageName = EdgePage.ITEM.name
                }
            },
        )
        EdgePage.ITEM -> EdgeItemPage(
            item = selectedItem,
            title = selectedModule?.title ?: selectedSection?.title ?: "Materials",
            onBack = { pageName = itemReturnPage },
        )
        EdgePage.CLASS -> EdgeWatchHost(
            viewModel = viewModel,
            state = enrichedState,
            courseId = edgeCourseKey(course.id),
            initialClassId = selectedClassId,
            onExit = { pageName = classReturnPage },
        )
    }
}

@Composable
private fun EdgeCourseHomePage(
    nav: NavHostController,
    detail: NativeEdgeCourseDetail,
    onHeader: (NativeEdgeHeader) -> Unit,
) {
    val course = detail.course
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Spacer(Modifier.height(4.dp)); EdgeBack({ nav.popBackStack() }, course.title) }
        item {
            Card(
                shape = RoundedCornerShape(20.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column {
                    if (course.thumbnailUrl.isNotBlank()) {
                        AsyncImage(
                            model = course.thumbnailUrl,
                            contentDescription = course.title,
                            modifier = Modifier.fillMaxWidth().aspectRatio(16f / 7f),
                            contentScale = ContentScale.Crop,
                        )
                    }
                    Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(course.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                if (course.hasAccess) Icons.Default.CheckCircle else Icons.Default.Lock,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                if (course.hasAccess && course.accessType == "free") "Free access" else if (course.hasAccess) "Access active" else "Preview mode",
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        Text(
                            "${detail.counts.sections} sections • ${detail.counts.items} items • ${detail.counts.videos} classes • ${detail.counts.materials} materials",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        if (detail.headers.isEmpty()) item { EdgeMessageCard("No course content is available yet.") }
        items(detail.headers, key = { it.id }) { header ->
            EdgeTile(
                title = header.title,
                subtitle = "${header.sections.size} sections",
                icon = Icons.Default.Folder,
            ) { onHeader(header) }
        }
        item { Spacer(Modifier.height(14.dp)) }
    }
}

@Composable
private fun EdgeHeaderPage(
    header: NativeEdgeHeader?,
    onBack: () -> Unit,
    onSection: (NativeEdgeSection) -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item { Spacer(Modifier.height(4.dp)); EdgeBack(onBack, header?.title ?: "Sections") }
        if (header == null || header.sections.isEmpty()) item { EdgeMessageCard("No section is available here yet.") }
        header?.let { group ->
            items(group.sections, key = { "section-${group.id}-${it.id}" }) { section ->
                val materialCount = section.materials.size + section.modules.sumOf { module -> module.items.count { item -> item.links.any { !it.playable } } }
                EdgeListCard(
                    title = section.title,
                    subtitle = "${section.modules.size} modules • $materialCount materials",
                    icon = Icons.Default.Folder,
                ) { onSection(section) }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun EdgeSectionPage(
    section: NativeEdgeSection?,
    onBack: () -> Unit,
    onModule: (NativeEdgeModule) -> Unit,
    onMaterials: () -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item { Spacer(Modifier.height(4.dp)); EdgeBack(onBack, section?.title ?: "Modules") }
        if (section == null || (section.modules.isEmpty() && section.materials.isEmpty())) {
            item { EdgeMessageCard("No module or material is available here yet.") }
        }
        section?.let { group ->
            items(group.modules, key = { "module-${group.id}-${it.id}" }) { module ->
                val videoCount = module.items.count { item -> item.links.any { link -> link.playable && link.url.isNotBlank() } }
                EdgeListCard(
                    title = module.title,
                    subtitle = "${module.items.size} items • $videoCount classes",
                    icon = Icons.Default.Folder,
                ) { onModule(module) }
            }
            if (group.materials.isNotEmpty()) {
                item {
                    EdgeListCard(
                        title = "Materials",
                        subtitle = "${group.materials.size} files & resources",
                        icon = Icons.Default.Description,
                        onClick = onMaterials,
                    )
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun EdgeModulePage(
    detail: NativeEdgeCourseDetail,
    header: NativeEdgeHeader?,
    section: NativeEdgeSection?,
    module: NativeEdgeModule?,
    onBack: () -> Unit,
    onItem: (NativeEdgeItem) -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item { Spacer(Modifier.height(4.dp)); EdgeBack(onBack, module?.title ?: "Classes") }
        if (module == null || module.items.isEmpty()) item { EdgeMessageCard("No class or material is available in this module yet.") }
        module?.let { group ->
            items(group.items, key = { "item-${header?.id}-${section?.id}-${group.id}-${it.id}" }) { item ->
                EdgeItemRow(item, detail.course.hasAccess) { onItem(item) }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun EdgeMaterialsPage(
    detail: NativeEdgeCourseDetail,
    header: NativeEdgeHeader?,
    section: NativeEdgeSection?,
    onBack: () -> Unit,
    onItem: (NativeEdgeItem) -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item { Spacer(Modifier.height(4.dp)); EdgeBack(onBack, "${section?.title ?: "Section"} • Materials") }
        if (section == null || section.materials.isEmpty()) item { EdgeMessageCard("No section material is available yet.") }
        section?.let { group ->
            items(group.materials, key = { "material-${header?.id}-${group.id}-${it.id}" }) { item ->
                EdgeItemRow(item, detail.course.hasAccess) { onItem(item) }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun EdgeItemPage(
    item: NativeEdgeItem?,
    title: String,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item { Spacer(Modifier.height(4.dp)); EdgeBack(onBack, item?.title ?: title) }
        if (item == null || item.links.isEmpty()) item { EdgeMessageCard("No resource link is available for this item.") }
        item?.let { row ->
            if (row.description.isNotBlank()) item { EdgeMessageCard(row.description) }
            items(row.links.filter { it.url.isNotBlank() }, key = { "link-${it.kind}-${it.url}" }) { link ->
                Card(
                    modifier = Modifier.fillMaxWidth().clickable {
                        NativeResourceViewerActivity.open(context, link.label, link.url)
                    },
                    shape = EdgeSmallShape,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (link.playable) Icons.Default.PlayArrow else Icons.Default.Description, contentDescription = null)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(link.label, fontWeight = FontWeight.Bold)
                            Text(edgeKindLabel(link.kind), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Icon(Icons.Default.ArrowForward, contentDescription = null)
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun EdgeItemRow(item: NativeEdgeItem, accessActive: Boolean, onClick: () -> Unit) {
    val playable = item.links.any { it.playable && it.url.isNotBlank() }
    val resources = item.links.count { !it.playable && it.url.isNotBlank() }
    val enabled = accessActive && !item.locked && item.links.any { it.url.isNotBlank() }
    Card(
        modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick),
        shape = EdgeSmallShape,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                Icon(
                    if (playable) Icons.Default.PlayArrow else Icons.Default.Description,
                    contentDescription = null,
                    modifier = Modifier.padding(9.dp).size(23.dp),
                )
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val meta = buildList {
                    if (playable) add("Class") else add(edgeKindLabel(item.kind))
                    if (resources > 0) add("$resources resources")
                }.joinToString(" • ")
                Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(if (enabled) Icons.Default.ArrowForward else Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(19.dp))
        }
    }
}

@Composable
private fun EdgeListCard(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.ExtraBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Default.ArrowForward, contentDescription = null)
        }
    }
}

@Composable
private fun EdgeTile(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(15.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                Icon(icon, contentDescription = null, modifier = Modifier.padding(12.dp).size(24.dp))
            }
            Spacer(Modifier.width(13.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.ExtraBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Default.ArrowForward, contentDescription = null)
        }
    }
}

@Composable
private fun EdgeBack(onBack: () -> Unit, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
        Text(
            title,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun EdgeBadge(text: String) {
    Surface(shape = EdgePillShape, color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)) {
        Text(
            text,
            Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.ExtraBold,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
private fun EdgeMessageCard(message: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = EdgeSmallShape,
    ) {
        Text(message, Modifier.padding(17.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun edgeClassRefs(detail: NativeEdgeCourseDetail): List<EdgeClassRef> {
    var order = 0
    val result = mutableListOf<EdgeClassRef>()
    detail.headers.forEach { header ->
        header.sections.forEach { section ->
            section.modules.forEach { module ->
                module.items.forEach { item ->
                    val video = item.links.firstOrNull { it.playable && it.url.isNotBlank() } ?: return@forEach
                    result += EdgeClassRef(
                        classId = edgeClassId(detail.course.id, header.id, section.id, module.id, item.id),
                        headerId = header.id,
                        sectionId = section.id,
                        moduleId = module.id,
                        headerTitle = header.title,
                        sectionTitle = section.title,
                        moduleTitle = module.title,
                        item = item,
                        primaryVideo = video,
                        order = order++,
                    )
                }
            }
            section.materials.forEach { item ->
                val video = item.links.firstOrNull { it.playable && it.url.isNotBlank() } ?: return@forEach
                result += EdgeClassRef(
                    classId = edgeClassId(detail.course.id, header.id, section.id, "materials", item.id),
                    headerId = header.id,
                    sectionId = section.id,
                    moduleId = "",
                    headerTitle = header.title,
                    sectionTitle = section.title,
                    moduleTitle = "Materials",
                    item = item,
                    primaryVideo = video,
                    order = order++,
                )
            }
        }
    }
    return result.distinctBy { it.classId }
}

private fun edgeEnrichedState(
    state: NativeUiState,
    detail: NativeEdgeCourseDetail,
    refs: List<EdgeClassRef>,
): NativeUiState {
    val courseId = edgeCourseKey(detail.course.id)
    val course = NativeCourse(
        id = courseId,
        title = detail.course.title,
        description = detail.course.description,
        thumbnailUrl = detail.course.thumbnailUrl,
        price = 0.0,
        courseFormat = "edgecourse",
    )
    val classes = refs.map { ref ->
        NativeClassItem(
            id = ref.classId,
            courseId = courseId,
            title = ref.item.title,
            topic = ref.item.description,
            subjects = listOf(ref.headerTitle),
            chapters = listOf(ref.sectionTitle, ref.moduleTitle).filter { it.isNotBlank() },
            order = ref.order,
            duration = "",
            sourceUrl = if (detail.course.hasAccess && !ref.item.locked) ref.primaryVideo.url else "",
            downloadUrl = if (detail.course.hasAccess && !ref.item.locked) ref.primaryVideo.url else "",
            teacherName = "EdgeCourse",
            imageUrl = detail.course.thumbnailUrl,
            resourceLinks = ref.item.links
                .filter { it.url.isNotBlank() && it.url != ref.primaryVideo.url }
                .distinctBy { it.url }
                .map { NativeResourceLink(it.label, it.url) },
            publishedAt = 0L,
            isArchived = false,
        )
    }
    val subjects = detail.headers.mapIndexed { index, header ->
        NativeSubject(
            id = "edge-header:${detail.course.id}:${header.id}",
            courseId = courseId,
            title = header.title,
            order = index,
        )
    }
    val content = NativeCourseContent(
        course = course,
        subjects = subjects,
        chapters = emptyList(),
        classes = classes,
    )
    return state.copy(
        courses = (state.courses + course).distinctBy { it.id },
        courseContent = state.courseContent + (courseId to content),
    )
}

@Composable
private fun EdgeWatchHost(
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    courseId: String,
    initialClassId: String,
    onExit: () -> Unit,
) {
    val watchNav = rememberNavController()
    var launched by remember(initialClassId) { mutableStateOf(false) }
    NavHost(watchNav, startDestination = "watch-root", modifier = Modifier.fillMaxSize()) {
        composable("watch-root") {
            LaunchedEffect(initialClassId) {
                if (!launched && initialClassId.isNotBlank()) {
                    launched = true
                    watchNav.navigate("class/${Uri.encode(courseId)}/${Uri.encode(initialClassId)}")
                } else if (launched) {
                    onExit()
                }
            }
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
        composable(
            "class/{courseId}/{classId}",
            listOf(
                navArgument("courseId") { type = NavType.StringType },
                navArgument("classId") { type = NavType.StringType },
            ),
        ) { entry ->
            val cid = Uri.decode(entry.arguments?.getString("courseId").orEmpty())
            val classId = Uri.decode(entry.arguments?.getString("classId").orEmpty())
            YoutubeClassWatchPage(watchNav, viewModel, state, cid, classId)
        }
    }
}

private fun edgeCourseKey(courseId: String): String = "edgecourse:$courseId"

private fun edgeClassId(courseId: String, headerId: String, sectionId: String, moduleId: String, itemId: String): String =
    "edgeclass:$courseId:$headerId:$sectionId:$moduleId:$itemId"

private fun edgeKindLabel(kind: String): String = when (kind.lowercase()) {
    "video" -> "Class video"
    "material" -> "Material"
    "practice" -> "Practice sheet"
    "solution" -> "Solution"
    "marked" -> "Marked copy"
    "ebook" -> "E-book"
    "pdf" -> "PDF"
    "exam" -> "Exam"
    else -> kind.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }.ifBlank { "Resource" }
}
