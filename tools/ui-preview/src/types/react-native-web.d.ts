/**
 * react-native-web ships no type declarations.
 *
 * A shorthand `declare module 'react-native-web';` would type the whole module
 * as `any`, and `export *` from an `any` module re-exports NOTHING, so every
 * `import { View } from 'react-native'` in your plugin would fail to resolve.
 * The names therefore have to be listed.
 *
 * This is not type safety and does not pretend to be: each export is `any`, and
 * the real checking of your components happens in your own repo against the
 * real React Native types. It exists so a `tsc` run here is quiet.
 *
 * If your plugin imports a component that is not listed, add it. That is
 * expected maintenance, not a bug.
 */
declare module 'react-native-web' {
  export const ActivityIndicator: any;
  export const Animated: any;
  export const AppRegistry: any;
  export const AppState: any;
  export const Appearance: any;
  export const BackHandler: any;
  export const Button: any;
  export const CheckBox: any;
  export const Clipboard: any;
  export const DeviceEventEmitter: any;
  export const Dimensions: any;
  export const Easing: any;
  export const FlatList: any;
  export const I18nManager: any;
  export const Image: any;
  export const ImageBackground: any;
  export const Keyboard: any;
  export const KeyboardAvoidingView: any;
  export const Linking: any;
  export const Modal: any;
  export const NativeEventEmitter: any;
  export const NativeModules: any;
  export const PanResponder: any;
  export const PixelRatio: any;
  export const Platform: any;
  export const Pressable: any;
  export const RefreshControl: any;
  export const SafeAreaView: any;
  export const ScrollView: any;
  export const SectionList: any;
  export const Share: any;
  export const StatusBar: any;
  export const StyleSheet: any;
  export const Switch: any;
  export const Text: any;
  export const TextInput: any;
  export const TouchableHighlight: any;
  export const TouchableOpacity: any;
  export const TouchableWithoutFeedback: any;
  export const Vibration: any;
  export const View: any;
  export const VirtualizedList: any;
  export const useColorScheme: any;
  export const useWindowDimensions: any;
}
