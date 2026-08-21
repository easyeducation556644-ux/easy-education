package com.easyeducation.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NativeGlobalPullRefresh(
    viewModel: NativeAppViewModel,
    state: NativeUiState,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    PullToRefreshBox(
        isRefreshing = state.syncing,
        onRefresh = {
            if (state.online) {
                viewModel.refreshAll()
                (context as? MainActivity)?.refreshScreenCapturePolicy()
                val uid = state.user?.uid.orEmpty()
                if (uid.isNotBlank()) {
                    scope.launch { NativeTrialStore.refresh(context, uid, online = true) }
                }
            }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        Box(Modifier.fillMaxSize()) { content() }
    }
}
