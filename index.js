/**
 * Plugin entry point: register the UI, start the SDK, add the toolbar button.
 *
 * @format
 */

import {AppRegistry, Image} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

import App from './App';
import {name as appName} from './app.json';

// appName must equal pluginKey in PluginConfig.json, or the host won't load it.
AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

// NOTE only: the export writes a page into a .note file, which DOC can't take.
PluginManager.registerButton(1, ['NOTE'], {
  id: 100,
  name: JSON.stringify({
    en: 'Soccer Board',
    zh_CN: '足球战术板',
    zh_TW: '足球戰術板',
    ja: 'サッカー作戦ボード',
  }),
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
});
