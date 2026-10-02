/**
 * Plugin entry point: register the UI, start the SDK, add the toolbar button.
 *
 * @format
 */

import {AppRegistry, Image} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

import App from './App';
import {name as appName} from './app.json';
import {startPaletteController} from './src/palette/controller';

// appName must equal pluginKey in PluginConfig.json, or the host won't load it.
AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

// Listens to the floating palette whether or not the panel is open.
startPaletteController();

// NOTE only: pieces go into a .note file, which DOC can't take.
PluginManager.registerButton(1, ['NOTE'], {
  id: 100,
  name: JSON.stringify({en: 'Tactics Board'}),
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
});
