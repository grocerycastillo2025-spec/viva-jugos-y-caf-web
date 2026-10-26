import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { OrderUpdates } from '../src/components/OrderUpdates';
import { configureMoney } from '../src/domain/money';
import { readLocaleConfig } from '../src/env';
import { BrandingProvider, useColors } from '../src/state/branding-context';
import { CartProvider } from '../src/state/cart-context';
import { PushProvider } from '../src/state/push-context';
import { SessionProvider } from '../src/state/session-context';
import { StoreProvider } from '../src/state/store-context';

// Moneda e idioma del negocio, antes de pintar el primer precio.
const localeConfig = readLocaleConfig();
configureMoney(localeConfig.currency, localeConfig.locale);

/**
 * El stack va en su propio componente porque necesita los colores de la
 * marca, y esos solo existen dentro de <BrandingProvider>.
 */
function RootStack(): ReactNode {
  const colors = useColors();

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="item/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="cart" options={{ presentation: 'modal' }} />
        <Stack.Screen name="store-picker" options={{ presentation: 'modal' }} />
        <Stack.Screen name="checkout" options={{ presentation: 'card' }} />
        <Stack.Screen name="pay/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="order/[id]" options={{ presentation: 'card' }} />
      </Stack>
    </>
  );
}

export default function RootLayout(): ReactNode {
  return (
    // SafeAreaProvider es obligatorio: Android 16 dibuja siempre
    // edge-to-edge y todas las pantallas leen los insets de aqui.
    //
    // Orden de los providers: branding y sucursales no dependen de nadie;
    // el carrito si depende de la sucursal elegida, asi que va dentro.
    <SafeAreaProvider>
      <BrandingProvider>
        <SessionProvider>
          <StoreProvider>
            <CartProvider>
              {/* Depende de la sesion: el token se guarda contra el
                  usuario, y al cerrar sesion se da de baja. */}
              <PushProvider>
                <RootStack />
                {/* Avisos de "tu pedido está listo" en cualquier pantalla. */}
                <OrderUpdates />
              </PushProvider>
            </CartProvider>
          </StoreProvider>
        </SessionProvider>
      </BrandingProvider>
    </SafeAreaProvider>
  );
}
