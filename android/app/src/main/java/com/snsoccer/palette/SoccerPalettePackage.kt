package com.snsoccer.palette

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers the floating palette module. buildPlugin finds this class (it
 * implements ReactPackage) and the `add(SoccerPalettePackage())` line in
 * MainApplication, and lists it in PluginConfig.json's reactPackages.
 */
class SoccerPalettePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(SoccerPaletteModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<in Nothing, in Nothing>> = emptyList()
}
