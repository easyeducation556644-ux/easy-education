from pathlib import Path

path = Path("android-app/app/src/main/java/com/easyeducation/app/NativeAppUiV2.kt")
text = path.read_text()

route_anchor = '''private fun String.inCourseRoutes(): Boolean =
    startsWith("course/") || startsWith("subject/") || startsWith("chapter/") || startsWith("class/") ||
        startsWith("archive/") || startsWith("archive-chapter/") || startsWith("past-classes") || startsWith("cps-exam/")
'''
route_replacement = '''private fun String.inCourseRoutes(): Boolean =
    startsWith("course/") || startsWith("subject/") || startsWith("chapter/") || startsWith("class/") ||
        startsWith("archive/") || startsWith("archive-chapter/") || startsWith("past-classes") || startsWith("cps")
'''
if route_anchor not in text:
    raise SystemExit("CPS route anchor not found")
text = text.replace(route_anchor, route_replacement, 1)

nav_anchor = '''        composable("home") { V2Home(nav, viewModel, state) }
        composable("courses") { V2Courses(nav, state) }
'''
nav_replacement = '''        composable("home") { V2Home(nav, viewModel, state) }
        composable("cps") { NativeCpsHubScreen(nav, state.online) }
        composable(
            "cps-preview/{courseId}",
            listOf(navArgument("courseId") { type = NavType.StringType }),
        ) { entry ->
            NativeCpsCoursePreviewScreen(
                nav = nav,
                encodedCourseId = entry.arguments?.getString("courseId").orEmpty(),
                online = state.online,
            )
        }
        composable("courses") { V2Courses(nav, state) }
'''
if nav_anchor not in text:
    raise SystemExit("CPS navigation anchor not found")
text = text.replace(nav_anchor, nav_replacement, 1)

home_anchor = '''    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(6.dp)) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
'''
home_replacement = '''    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Spacer(Modifier.height(6.dp)) }
        item { NativeCpsHomeHero(nav = nav, online = state.online) }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
'''
if home_anchor not in text:
    raise SystemExit("CPS home anchor not found")
text = text.replace(home_anchor, home_replacement, 1)

path.write_text(text)

# Build-time guard: the release must contain one top CPS hero and both CPS destinations.
result = path.read_text()
checks = [
    'NativeCpsHomeHero(nav = nav, online = state.online)',
    'composable("cps")',
    '"cps-preview/{courseId}"',
]
missing = [needle for needle in checks if needle not in result]
if missing:
    raise SystemExit("CPS home wiring failed: " + ", ".join(missing))
print("PASS: CPS hero is first Home content and CPS routes are wired")
