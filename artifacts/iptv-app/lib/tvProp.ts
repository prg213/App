import { Platform } from 'react-native';

/**
 * #247: TV prop helper.
 *
 * Returns an object of TV-specific props (hasTVPreferredFocus,
 * tvParallaxProperties, …) **only** when running on a TV platform
 * (Android TV, Fire TV, Apple TV / tvOS).  On non-TV platforms the returned
 * object is empty, so spreading it onto a Pressable/TouchableOpacity has zero
 * effect.
 *
 * @example
 *   <Pressable {...tvProp({ hasTVPreferredFocus: isFirstItem })} onPress={…} />
 *
 * Why a helper instead of inline checks?
 *   - One place to update if the React Native TV API changes.
 *   - Prevents the common mistake of setting hasTVPreferredFocus={true} on
 *     non-TV builds, which has no effect but adds visual noise to the prop table.
 *   - TypeScript infers the return type as the exact subset of props passed in,
 *     so callers never receive unexpected keys.
 */
export function tvProp<T extends {
  hasTVPreferredFocus?: boolean;
  tvParallaxProperties?: object;
}>(props: T): T | Record<string, never> {
  if (!Platform.isTV) return {};
  return props;
}
