/**
 * Todos los textos de interfaz, en un solo sitio.
 *
 * El publico esta en Estados Unidos, asi que la copia es en ingles. Viva
 * tiene ademas clientela hispanohablante en Freehold, y por eso esto vive
 * centralizado: el dia que haga falta espanol, se anade un segundo objeto
 * con las mismas claves y un selector, sin tocar ni una pantalla.
 *
 * No es i18n completo a proposito. No hay libreria, ni plurales por
 * locale, ni carga diferida: solo un objeto tipado. Lo que se gana hoy es
 * que ningun texto viva suelto dentro de un componente.
 *
 * Convencion: lo que necesita datos es una funcion; el resto, una cadena.
 */

export const strings = {
  common: {
    retry: 'Try again',
    refresh: 'Refresh',
    cancel: 'Cancel',
    close: 'Close',
    back: 'Back',
    loading: 'Loading…',
    continue: 'Continue',
    done: 'Done',
    remove: 'Remove',
    technicalDetail: 'Show technical detail',
    hideTechnicalDetail: 'Hide technical detail',
  },

  tabs: {
    home: 'Home',
    menu: 'Menu',
    orders: 'Orders',
    rewards: 'Rewards',
    profile: 'Profile',
  },

  home: {
    heroTitle: 'Fresh, made to order',
    heroBody:
      'Cold-pressed juices, bowls and specialty coffee. Order ahead and pick it up at the counter.',
    seeMenu: 'See the menu',
    featured: 'Featured',
    noFeatured: 'This location has no featured items yet. Take a look at the full menu.',
    change: 'Change',
    closedToday: 'Closed today',
    hoursToday: (opens: string, closes: string): string => `Today ${opens} – ${closes}`,
    pickup: 'Pickup in store',
    noPickup: 'No pickup',
    delivery: ' · Delivery',
    directions: (address: string): string => `Open ${address} in Google Maps`,
    noStoreTitle: 'No location available',
    noStoreBody: (brand: string): string => `No ${brand} location is open in the app right now.`,
  },

  menu: {
    title: 'Menu',
    loading: 'Loading the menu…',
    emptyTitle: 'This location has no menu yet',
    emptyPickStore: 'Pick a location to see its menu.',
    uncategorized: 'More',
    emptyBody: (store: string): string =>
      `${store} has no published items. In development, check that supabase/seed/seed_viva.sql has been applied.`,
    changeStoreHint: (store: string): string => `Location ${store}. Tap to change`,
    addToCart: (name: string): string => `Add ${name} to the cart`,
    chooseOptionsFor: (name: string): string => `Choose options for ${name}`,
  },

  item: {
    required: 'Required',
    optional: 'Optional',
    pickOne: 'Required · pick 1',
    pickAtLeast: (min: number): string => `Required · pick at least ${min}`,
    pickBetween: (min: number, max: number): string => `Required · pick ${min} to ${max}`,
    atMostOne: 'Optional · pick at most 1',
    atMost: (max: number): string => `Optional · pick at most ${max}`,
    chooseOne: (group: string): string => `Choose an option for ${group}`,
    chooseAtLeast: (min: number, group: string): string => `Choose at least ${min} from ${group}`,
    tooMany: (max: number, group: string): string => `At most ${max} from ${group}`,
    optionGone: (group: string): string => `An option in ${group} is no longer available`,
    kitchenNote: 'Note for the kitchen',
    kitchenNotePlaceholder: 'No ice, less sweet…',
    quantity: 'Quantity',
    addOne: 'Add one',
    removeOne: 'Remove one',
    add: (total: string): string => `Add · ${total}`,
    unavailable: 'Unavailable',
    unavailableNow: 'This item is not available right now.',
    goneFromMenu: 'This item is no longer on this location’s menu.',
  },

  cart: {
    title: 'Your cart',
    viewCart: 'View cart',
    emptyTitle: 'Nothing here yet',
    emptyBody: 'Take a look at the menu and add your first item.',
    goToMenu: 'Go to the menu',
    each: (price: string): string => `${price} each`,
    clear: 'Empty cart',
    subtotal: (count: number): string =>
      count === 1 ? 'Subtotal · 1 item' : `Subtotal · ${count} items`,
    taxNote: 'Taxes and total are calculated by the register when the order is confirmed.',
    storePrices: ' · prices for this location',
    changeStoreNote: ' If you switch locations, we check prices before applying anything.',
    checkout: 'Choose a pickup time',
    itemCount: (count: number): string => (count === 1 ? '1 item' : `${count} items`),
  },

  storePicker: {
    title: 'Choose a location',
    reviewTitle: 'Review your cart',
    searching: 'Finding locations…',
    noneTitle: 'No locations are open',
    noneBody: 'No location for this brand is available right now. Try again in a bit.',
    cartWarning:
      'You have items in your cart. If you switch locations, we will check prices before applying anything.',
    lead: (store: string): string =>
      `${store} has its own menu and its own prices. Here is what changes if you move to this location:`,
    removedOne: '1 item cannot stay in your cart.',
    removedMany: (count: number): string => `${count} items cannot stay in your cart.`,
    willBeRemoved: 'Removed',
    priceChanges: 'Price changes',
    subtotalNow: 'Subtotal now',
    subtotalAt: (store: string): string => `Subtotal at ${store}`,
    taxNote: 'Taxes and total are calculated by that location’s register.',
    switchAndEmpty: (store: string): string => `Switch to ${store} and empty the cart`,
    switchTo: (store: string): string => `Switch to ${store}`,
    stayHere: 'Stay where I am',
    checking: 'Checking…',
    paused: 'Paused · not taking orders',
    notOnMenu: 'Not on this location’s menu.',
    notAvailableHere: 'Not available at this location right now.',
    priceWas: (before: string, after: string): string => `Price: ${before} → ${after}`,
    modifierGone: (name: string): string => `${name} does not exist at this location.`,
    modifierOut: (name: string): string => `${name} is sold out here.`,
    modifierPrice: (name: string, before: string, after: string): string =>
      `${name}: ${before} → ${after}`,
  },

  auth: {
    signInTitle: 'Sign in',
    signUpTitle: 'Create your account',
    body: 'Save your orders and earn points. All you need is an email.',
    firstName: 'First name',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    signUp: 'Create account',
    noAccount: 'I don’t have an account',
    haveAccount: 'I already have an account',
    signOut: 'Sign out',
    google: 'Continue with Google',
    orEmail: 'or use your email',
    signInFailed: 'Could not sign in',
    signUpFailed: 'Could not create your account',
    signInToOrder: 'Sign in to place your order',
    signInToOrderBody: 'We keep your order in your account so you can track it and reorder later.',
    checkYourEmail: 'Check your email',
    checkYourEmailBody: 'We sent you a link to confirm your address.',
  },

  /**
   * Recargo por tarjeta de credito.
   *
   * TODAS las cadenas de aqui llevan el importe dentro, y ninguna existe
   * en version "hay un recargo" a secas. No es estilo: la FAQ de la NJ
   * Division of Consumer Affairs (P.L. 2023, c.146) pone justo ese cartel
   * —"imponemos un recargo que no excede nuestros costes de
   * procesamiento"— como ejemplo de lo que NO cumple. Por eso cada texto
   * es una funcion que EXIGE el porcentaje: no se puede pintar el aviso
   * sin la cifra ni por descuido.
   *
   * Tampoco vale "hasta un 3 %": un maximo no es un importe. Va "3 %", y
   * el porcentaje lo redondea hacia arriba `formatRatePercent`.
   */
  surcharge: {
    title: (percent: string): string => `${percent} credit card surcharge`,
    body: (percent: string): string =>
      `Paying with a credit card adds ${percent} to your total. The register applies it, ` +
      'together with taxes, when your payment goes through.',
    short: (percent: string): string => `Credit card payments include a ${percent} surcharge.`,
    menuNote: (percent: string): string =>
      `Menu prices do not include the ${percent} credit card surcharge.`,
    a11y: (percent: string): string =>
      `Notice. Paying with a credit card at this location adds ${percent} to your total.`,
  },

  checkout: {
    title: 'Pickup time',
    asap: 'As soon as possible',
    asapReady: (time: string): string => `Ready around ${time}`,
    pickTime: 'Pick a time',
    today: 'Today',
    tomorrow: 'Tomorrow',
    noSlotsTitle: 'No pickup times available',
    noSlotsBody:
      'This location has no open slots right now. Try again later or pick another location.',
    closedTitle: 'This location is closed',
    closedBody: 'Orders open again during business hours.',
    full: 'Full',
    summary: 'Order summary',
    subtotal: 'Subtotal',
    taxNote:
      'Taxes, tip and total are calculated by the register when the order is confirmed. You are not charged yet.',
    placeOrder: 'Place order',
    placing: 'Placing your order…',
    orderFailed: 'Could not place your order',
    noteForStore: 'Anything else we should know?',
    noteplaceholder: 'Optional',
    slotTaken: 'That time just filled up. Pick another one.',
    cartChanged: 'Your cart changed. Check it before continuing.',
  },

  payment: {
    title: 'Payment',
    // El aviso de simulacion no es un detalle: mientras el cobro sea de
    // mentira, decir "pagado" a secas seria mentir.
    simulatedTitle: 'Simulated payment',
    simulatedBody:
      'This build has no payment provider connected. No card is used, no money moves, and the store does not receive this ticket yet. Real payments arrive with Clover.',
    simulatedShort: 'Simulated · no money moved',
    amountDue: 'Amount due',
    subtotalNote:
      'This is the subtotal. Taxes and the final total are calculated by the register.',
    method: 'Test card',
    methodNote: 'Pick how the test card should behave.',
    approve: 'Approves the payment',
    declineCard: 'Declines · card declined',
    declineFunds: 'Declines · insufficient funds',
    pay: (amount: string): string => `Pay ${amount}`,
    paying: 'Processing…',
    payLater: 'Not now',
    payNow: 'Complete payment',
    retry: 'Try the payment again',
    declinedTitle: 'The payment was declined',
    declined: {
      card_declined: 'The card was declined. Try a different one.',
      insufficient_funds: 'There are not enough funds on that card.',
      declined: 'The payment did not go through.',
    },
    // El caso que importa: el dinero se movio y no lo pudimos guardar.
    // Reintentar aqui NO vuelve a cobrar, y hay que decirlo.
    unrecordedTitle: 'Paid, but we could not save it',
    unrecordedBody:
      'The payment went through. We could not write it down, so the order is not confirmed yet. Finishing this will not charge you again.',
    finishSaving: 'Finish saving the payment',
    saving: 'Saving…',
    // Distinto del anterior: aqui reintentar no arregla nada, y ofrecer
    // un boton de reintento seria mandar al cliente a un bucle.
    orphanedTitle: 'Processed, but this order could not accept it',
    orphanedBody:
      'The payment went through and this order could not take it. Do not pay again. Show this screen at the counter and we will sort it out.',
    orphanedRef: (reference: string): string => `Payment reference: ${reference}`,
    orderNotPayable: 'This order is not waiting for a payment.',
    disabledTitle: 'Simulated payments are off here',
    disabledBody:
      'This location is connected to a real payment provider, so the app cannot mark orders as paid on its own.',
    amountMismatch: 'The amount changed. Reopen the order and try again.',
    conflict: 'That payment attempt belongs to another order.',
    failed: 'Could not process the payment',
    history: 'Payment attempts',
    attempt: (status: string, amount: string, when: string): string =>
      `${status} · ${amount} · ${when}`,
    statusLabel: {
      pending: 'Pending',
      succeeded: 'Paid',
      failed: 'Declined',
      voided: 'Voided',
    },
  },

  order: {
    title: 'Your order',
    number: (n: number): string => `Order #${n}`,
    pickupCode: 'Pickup code',
    pickupCodeHint: 'Show this code at the counter.',
    estimatedFor: (time: string): string => `Estimated for ${time}`,
    asapEstimate: 'As soon as possible',
    itemsTitle: 'Items',
    subtotal: 'Subtotal',
    taxNote: 'Taxes and total are calculated by the register.',
    placedAt: (when: string): string => `Placed ${when}`,
    reorder: 'Order this again',
    reorderAdded: 'Added to your cart',
    trackingNote:
      'We will let you know when your order is being prepared. Pickup times are estimates, not guarantees.',
    notFound: 'We could not find that order.',
    simulatedConfirmed:
      'Confirmed with a simulated payment: no money moved and no ticket reached the store. This is what the flow will look like once Clover is connected.',
    payPending: 'Finish the payment to send this order to the store.',
    // Etiquetas de estado. Regla dura (Variable 1 del addendum): NUNCA se
    // dice "listo", porque Clover no modela el fin de la preparacion y no
    // tenemos forma de observarlo. Se promete una hora estimada.
    status: {
      draft: 'Draft',
      payment_pending: 'Waiting for payment',
      payment_failed: 'Payment failed',
      confirmed: 'Order confirmed',
      preparing: 'Being prepared',
      ready: 'You can pick it up',
      completed: 'Picked up',
      canceled: 'Canceled',
      refunded: 'Refunded',
    },
    statusHint: {
      draft: 'This order has not been sent yet.',
      payment_pending: 'We are waiting for the payment to go through. Nothing is confirmed yet.',
      payment_failed: 'The payment did not go through, so the order was not sent to the store.',
      confirmed: 'The store has your order.',
      preparing: 'The ticket printed in the kitchen.',
      ready: 'Head to the counter with your pickup code.',
      completed: 'Thanks for coming by.',
      canceled: 'This order was canceled.',
      refunded: 'This order was refunded.',
    },
  },

  orders: {
    title: 'Orders',
    signInTitle: 'Sign in to see your orders',
    signInBody: 'Your history is saved to your account. You can create one from the Profile tab.',
    emptyTitle: 'No orders yet',
    emptyBody: 'When you place your first order it will show up here with its pickup code.',
    active: 'In progress',
    past: 'Past orders',
    itemsCount: (count: number): string => (count === 1 ? '1 item' : `${count} items`),
  },

  rewards: {
    title: 'Rewards',
    yourPoints: 'Your points',
    signInPrompt: 'Sign in from the Profile tab to start earning.',
    inactive: (brand: string): string => `The loyalty program is not active for ${brand}.`,
    earnRate: (perDollar: number, minRedeem: number): string =>
      `You earn ${perDollar} point(s) per dollar. You need ${minRedeem} to redeem.`,
    catalog: 'Rewards catalog',
    empty: 'No rewards are set up yet. They are configured from the admin panel.',
    points: (n: number): string => `${n} pts`,
    footnote:
      'Redemptions are applied as a line-item discount so the store’s ticket adds up. Coming with checkout.',
  },

  push: {
    title: 'Order notifications',
    body: 'We can let you know when the store starts preparing your order.',
    enable: 'Turn on notifications',
    enabling: 'Just a moment…',
    on: 'Notifications are on',
    onBody: 'You will get a heads-up on this phone when your order moves along.',
    // Android 13+ solo ensena el dialogo una vez; despues, Ajustes.
    blocked: 'Notifications are off',
    blockedBody:
      'You said no earlier, so Android will not ask again. You can turn them back on in the phone settings, under Apps → Viva Juice → Notifications.',
    signInFirst: 'Sign in to get order updates on this phone.',
    unsupported: {
      'no-device': 'Notifications need a real phone; this looks like an emulator.',
      'no-fcm':
        'This build does not carry the Firebase configuration, so it cannot receive notifications. The next build will.',
      'no-project': 'This build is missing its Expo project id, so it cannot register for notifications.',
      web: 'Order notifications are available in the phone app. Here on the web, you can follow your order from the Orders tab.',
    },
    failed: 'We could not turn on notifications',
  },

  profile: {
    title: 'Profile',
    customer: 'Customer',
    location: 'Location',
    timezone: (tz: string): string => `Time zone: ${tz}`,
    changeStore: 'Change location',
    cart: 'Cart',
    cartEmpty: 'Empty',
    cartCount: (count: number): string => `${count} item(s) saved on this device.`,
    footnote:
      'This app only uses the publishable Supabase key. Payment data and Clover credentials live in the backend, never here.',
  },

  notFound: {
    title: 'This screen does not exist',
    body: 'The link you followed does not go anywhere.',
    goHome: 'Back to home',
  },

  /**
   * Copia de los estados de error. `classifyError` decide el TIPO; el
   * texto vive aqui, para que se traduzca con todo lo demas.
   */
  dataError: {
    config: {
      title: 'The app is not configured',
      message: 'This build has no Supabase credentials.',
      hint: 'Copy apps/mobile/.env.example to .env.local and fill in the URL and the publishable key.',
    },
    badKey: {
      title: 'Wrong Supabase key',
      hint: 'Use the publishable key (sb_publishable_…), never the secret one.',
    },
    auth: {
      title: 'Credentials rejected',
      message: 'Supabase did not accept this build’s key.',
      hint: 'The key may have been rotated. The build has to be regenerated with the current publishable key.',
    },
    permission: {
      title: 'Not allowed to read this',
      message: 'The database rejected the query on permissions.',
      hint: 'Usually a missing GRANT for the anonymous role or an RLS policy. Check migrations 0004 and 0006.',
    },
    offline: {
      title: 'No connection',
      message: 'We could not reach the server.',
      hint: 'Check that the phone has internet and try again.',
    },
    notFound: {
      title: 'Part of the schema is missing',
      message: 'The database does not have the table or view the app is asking for.',
      hint: 'Apply the migrations with `pnpm db:push` and the development seed.',
    },
    server: {
      title: 'The server failed',
      message: 'Supabase returned an internal error.',
      hint: 'This is usually temporary. Try again in a moment.',
    },
    unknown: {
      title: 'Something went wrong',
      message: 'We could not load this.',
      hint: 'If it happens again, send us a screenshot of this screen.',
    },
  },
} as const;

export type Strings = typeof strings;
