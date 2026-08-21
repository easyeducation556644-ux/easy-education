from pathlib import Path

path = Path("android-app/app/src/main/java/com/easyeducation/app/NativeAppUiV2.kt")
text = path.read_text()

old_routes = '''private fun String.inCourseRoutes(): Boolean =
    startsWith("course/") || startsWith("subject/") || startsWith("chapter/") || startsWith("class/") ||
        startsWith("archive/") || startsWith("archive-chapter/") || startsWith("past-classes")
'''
new_routes = '''private fun String.inCourseRoutes(): Boolean =
    startsWith("course/") || startsWith("subject/") || startsWith("chapter/") || startsWith("class/") ||
        startsWith("archive/") || startsWith("archive-chapter/") || startsWith("past-classes") || startsWith("cps-exam/")
'''
if old_routes not in text:
    raise SystemExit("course route anchor not found")
text = text.replace(old_routes, new_routes, 1)

old_nav_end = '''        composable(
            "class/{courseId}/{classId}",
            listOf(navArgument("courseId") { type = NavType.StringType }, navArgument("classId") { type = NavType.StringType }),
        ) { entry ->
            YoutubeClassWatchPage(
                nav = nav,
                viewModel = viewModel,
                state = state,
                courseId = entry.arguments?.getString("courseId").orEmpty(),
                classId = entry.arguments?.getString("classId").orEmpty(),
            )
        }
    }
}
'''
new_nav_end = '''        composable(
            "class/{courseId}/{classId}",
            listOf(navArgument("courseId") { type = NavType.StringType }, navArgument("classId") { type = NavType.StringType }),
        ) { entry ->
            YoutubeClassWatchPage(
                nav = nav,
                viewModel = viewModel,
                state = state,
                courseId = entry.arguments?.getString("courseId").orEmpty(),
                classId = entry.arguments?.getString("classId").orEmpty(),
            )
        }
        composable(
            "cps-exam/{courseId}/{examId}",
            listOf(navArgument("courseId") { type = NavType.StringType }, navArgument("examId") { type = NavType.StringType }),
        ) { entry ->
            NativeCpsExamScreen(
                nav = nav,
                courseId = entry.arguments?.getString("courseId").orEmpty(),
                examId = entry.arguments?.getString("examId").orEmpty(),
            )
        }
    }
}
'''
if old_nav_end not in text:
    raise SystemExit("nav host anchor not found")
text = text.replace(old_nav_end, new_nav_end, 1)

old_course_anchor = '''    val course = content.course ?: state.courses.firstOrNull { it.id == courseId }
    val regularClasses = content.classes.filterNot { it.isArchived }
    val hasArchive = content.classes.any { it.isArchived }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
'''
new_course_anchor = '''    val course = content.course ?: state.courses.firstOrNull { it.id == courseId }
    val regularClasses = content.classes.filterNot { it.isArchived }
    val hasArchive = content.classes.any { it.isArchived }
    val cpsExtras = state.cpsCourseExtras[courseId]

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
'''
if old_course_anchor not in text:
    raise SystemExit("course state anchor not found")
text = text.replace(old_course_anchor, new_course_anchor, 1)

old_sections = '''        if (hasArchive) {
            item { NativeArchiveEntryCard { nav.navigate("archive/$courseId") } }
        }
        when {
'''
new_sections = '''        if (hasArchive) {
            item { NativeArchiveEntryCard { nav.navigate("archive/$courseId") } }
        }
        cpsExtras?.let { extras ->
            if (extras.accessExpiresAtMs > 0L) {
                item {
                    V2OutlinedCard {
                        Column(Modifier.padding(14.dp)) {
                            Text("CPS trial access", fontWeight = FontWeight.Bold)
                            Text(
                                "Available until ${SimpleDateFormat("dd MMM yyyy, h:mm a", Locale.getDefault()).format(Date(extras.accessExpiresAtMs))}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            if (extras.routines.isNotBlank()) {
                item {
                    V2OutlinedCard {
                        Column(Modifier.padding(14.dp)) {
                            Text("Routine", fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(5.dp))
                            Text(extras.routines, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            if (extras.liveClasses.isNotEmpty()) {
                item { V2Section("Live classes") }
                items(extras.liveClasses, key = { "cps-live-${it.id}" }) { live ->
                    NativeCpsLiveClassCard(live)
                }
            }
            if (extras.exams.isNotEmpty()) {
                item { V2Section("Exams") }
                items(extras.exams, key = { "cps-exam-${it.id}" }) { exam ->
                    NativeCpsExamCard(exam) {
                        nav.navigate("cps-exam/$courseId/${Uri.encode(exam.id)}")
                    }
                }
            }
        }
        when {
'''
if old_sections not in text:
    raise SystemExit("course section anchor not found")
text = text.replace(old_sections, new_sections, 1)

path.write_text(text)
print("CPS UI patch applied")
