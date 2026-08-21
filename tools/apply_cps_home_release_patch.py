from pathlib import Path

path = Path("android-app/app/src/main/java/com/easyeducation/app/NativeAppUiV2.kt")
text = path.read_text()

# Release builds must compile the committed CPS UI exactly as reviewed. This script is deliberately
# verification-only: it must never rewrite the app during CI.
checks = [
    'item { NativeCpsHomeBlock(nav, state) }',
    'composable("cps") { NativeCpsCatalogScreen(nav, state) }',
    'NativeCpsCourseScreen(nav, viewModel, state, courseId)',
]
missing = [needle for needle in checks if needle not in text]
if missing:
    raise SystemExit("Committed CPS wiring is incomplete: " + ", ".join(missing))

home = text.find('private fun V2Home(')
home_block = text.find('item { NativeCpsHomeBlock(nav, state) }', home)
greeting = text.find('"Hi ${state.profile?.name', home)
if home < 0 or home_block < 0 or greeting < 0 or not (home < home_block < greeting):
    raise SystemExit("CPS block is not the first functional Home content")

for forbidden in ('NativeCpsHomeHero(', 'NativeCpsHubScreen(', 'NativeCpsCoursePreviewScreen('):
    if forbidden in text:
        raise SystemExit("Legacy build-time CPS UI wiring is still present: " + forbidden)

print("PASS: committed CPS Home/catalog/course wiring is final; CI performed no source rewrite")
