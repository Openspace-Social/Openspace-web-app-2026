// Must be the first import — react-native-gesture-handler requires setup
// before any other module that might use gestures (react-navigation stack swipes,
// swipe-to-close drawers, etc.).
import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
