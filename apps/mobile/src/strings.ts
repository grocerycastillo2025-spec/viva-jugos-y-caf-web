/**
 * Todos los textos de interfaz, en un solo sitio.
 *
 * VIVA Jugos y Café opera en México: la copia es en español de México.
 * (Esta app nacio como la de Viva Juice and Coffee, en Estados Unidos, en
 * ingles; al pasar a este negocio se tradujo este archivo y ninguna
 * pantalla tuvo que tocarse, que era justo la razon de centralizarlo.)
 *
 * No es i18n completo a proposito. No hay libreria, ni plurales por
 * locale, ni carga diferida: solo un objeto tipado. Lo que se gana hoy es
 * que ningun texto viva suelto dentro de un componente.
 *
 * Convencion: lo que necesita datos es una funcion; el resto, una cadena.
 */

export const strings = {
  common: {
    retry: 'Intentar de nuevo',
    refresh: 'Actualizar',
    cancel: 'Cancelar',
    close: 'Cerrar',
    back: 'Atrás',
    loading: 'Cargando…',
    continue: 'Continuar',
    done: 'Listo',
    remove: 'Quitar',
    technicalDetail: 'Ver detalle técnico',
    hideTechnicalDetail: 'Ocultar detalle técnico',
  },

  tabs: {
    home: 'Inicio',
    menu: 'Menú',
    orders: 'Pedidos',
    rewards: 'Puntos',
    profile: 'Perfil',
  },

  home: {
    heroTitle: 'Fresco, hecho al momento',
    heroBody:
      'Jugos naturales, licuados, licuados con proteína y café. Pide desde aquí y recoge en el mostrador.',
    seeMenu: 'Ver el menú',
    featured: 'Destacados',
    noFeatured: 'Todavía no hay productos destacados. Échale un ojo al menú completo.',
    change: 'Cambiar',
    closedToday: 'Hoy cerrado',
    hoursToday: (opens: string, closes: string): string => `Hoy ${opens} – ${closes}`,
    pickup: 'Recoger en tienda',
    noPickup: 'Sin pedidos para recoger',
    delivery: ' · A domicilio',
    directions: (address: string): string => `Abrir ${address} en Google Maps`,
    noStoreTitle: 'No hay sucursal disponible',
    noStoreBody: (brand: string): string => `Ninguna sucursal de ${brand} está abierta en la app ahora.`,
  },

  menu: {
    title: 'Menú',
    loading: 'Cargando el menú…',
    emptyTitle: 'Todavía no hay menú',
    emptyPickStore: 'Elige una sucursal para ver su menú.',
    uncategorized: 'Más',
    emptyBody: (store: string): string =>
      `${store} todavía no tiene productos publicados. Se dan de alta desde el Panel del negocio.`,
    changeStoreHint: (store: string): string => `Sucursal ${store}. Toca para cambiar`,
    addToCart: (name: string): string => `Agregar ${name} al carrito`,
    chooseOptionsFor: (name: string): string => `Elegir opciones de ${name}`,
  },

  item: {
    required: 'Obligatorio',
    optional: 'Opcional',
    pickOne: 'Obligatorio · elige 1',
    pickAtLeast: (min: number): string => `Obligatorio · elige al menos ${min}`,
    pickBetween: (min: number, max: number): string => `Obligatorio · elige de ${min} a ${max}`,
    atMostOne: 'Opcional · máximo 1',
    atMost: (max: number): string => `Opcional · máximo ${max}`,
    chooseOne: (group: string): string => `Elige una opción de ${group}`,
    chooseAtLeast: (min: number, group: string): string => `Elige al menos ${min} de ${group}`,
    tooMany: (max: number, group: string): string => `Máximo ${max} de ${group}`,
    optionGone: (group: string): string => `Una opción de ${group} ya no está disponible`,
    kitchenNote: 'Nota para la barra',
    kitchenNotePlaceholder: 'Sin hielo, menos dulce…',
    quantity: 'Cantidad',
    addOne: 'Agregar uno',
    removeOne: 'Quitar uno',
    add: (total: string): string => `Agregar · ${total}`,
    unavailable: 'Agotado',
    unavailableNow: 'Este producto no está disponible ahora.',
    goneFromMenu: 'Este producto ya no está en el menú de esta sucursal.',
  },

  cart: {
    title: 'Tu carrito',
    viewCart: 'Ver carrito',
    emptyTitle: 'Aún no hay nada',
    emptyBody: 'Échale un ojo al menú y agrega tu primer producto.',
    goToMenu: 'Ir al menú',
    each: (price: string): string => `${price} c/u`,
    clear: 'Vaciar carrito',
    subtotal: (count: number): string =>
      count === 1 ? 'Total · 1 producto' : `Total · ${count} productos`,
    taxNote: 'Precios con IVA incluido. Pagas al recoger tu pedido.',
    storePrices: ' · precios de esta sucursal',
    changeStoreNote: ' Si cambias de sucursal, revisamos los precios antes de aplicar nada.',
    checkout: 'Elegir hora para recoger',
    itemCount: (count: number): string => (count === 1 ? '1 producto' : `${count} productos`),
  },

  storePicker: {
    title: 'Elige una sucursal',
    reviewTitle: 'Revisa tu carrito',
    searching: 'Buscando sucursales…',
    noneTitle: 'No hay sucursales abiertas',
    noneBody: 'Ninguna sucursal está disponible ahora. Intenta en un rato.',
    cartWarning:
      'Tienes productos en el carrito. Si cambias de sucursal, revisamos los precios antes de aplicar nada.',
    lead: (store: string): string =>
      `${store} tiene su propio menú y sus propios precios. Esto cambia si te pasas a esta sucursal:`,
    removedOne: '1 producto no puede quedarse en tu carrito.',
    removedMany: (count: number): string => `${count} productos no pueden quedarse en tu carrito.`,
    willBeRemoved: 'Se quita',
    priceChanges: 'Cambios de precio',
    subtotalNow: 'Total ahora',
    subtotalAt: (store: string): string => `Total en ${store}`,
    taxNote: 'Precios con IVA incluido.',
    switchAndEmpty: (store: string): string => `Cambiar a ${store} y vaciar el carrito`,
    switchTo: (store: string): string => `Cambiar a ${store}`,
    stayHere: 'Quedarme aquí',
    checking: 'Revisando…',
    paused: 'En pausa · no recibe pedidos',
    notOnMenu: 'No está en el menú de esta sucursal.',
    notAvailableHere: 'No está disponible en esta sucursal ahora.',
    priceWas: (before: string, after: string): string => `Precio: ${before} → ${after}`,
    modifierGone: (name: string): string => `${name} no existe en esta sucursal.`,
    modifierOut: (name: string): string => `${name} está agotado aquí.`,
    modifierPrice: (name: string, before: string, after: string): string =>
      `${name}: ${before} → ${after}`,
  },

  auth: {
    signInTitle: 'Inicia sesión',
    signUpTitle: 'Crea tu cuenta',
    body: 'Guarda tus pedidos y síguelos desde aquí. Solo necesitas un correo.',
    firstName: 'Nombre',
    email: 'Correo',
    password: 'Contraseña',
    signIn: 'Entrar',
    signUp: 'Crear cuenta',
    noAccount: 'No tengo cuenta',
    haveAccount: 'Ya tengo cuenta',
    signOut: 'Cerrar sesión',
    google: 'Continuar con Google',
    orEmail: 'o usa tu correo',
    signInFailed: 'No se pudo iniciar sesión',
    signUpFailed: 'No se pudo crear tu cuenta',
    signInToOrder: 'Inicia sesión para hacer tu pedido',
    signInToOrderBody: 'Guardamos tu pedido en tu cuenta para que lo sigas y lo repitas después.',
    checkYourEmail: 'Revisa tu correo',
    checkYourEmailBody: 'Te enviamos un enlace para confirmar tu correo.',
  },

  /**
   * Recargo por tarjeta de credito. Venia de la ley de Nueva Jersey para
   * la app de Estados Unidos; en este negocio no se cobra con tarjeta en
   * la app y la sucursal se da de alta con recargo 0, asi que no se
   * muestra. Se conserva traducido por si algun dia aplica.
   */
  surcharge: {
    title: (percent: string): string => `Recargo de ${percent} por pago con tarjeta`,
    body: (percent: string): string =>
      `Pagar con tarjeta de crédito suma ${percent} a tu total. Se aplica al cobrar.`,
    short: (percent: string): string => `Los pagos con tarjeta incluyen un recargo de ${percent}.`,
    menuNote: (percent: string): string =>
      `Los precios del menú no incluyen el recargo de ${percent} por pago con tarjeta.`,
    a11y: (percent: string): string =>
      `Aviso. Pagar con tarjeta en esta sucursal suma ${percent} a tu total.`,
  },

  checkout: {
    title: 'Hora para recoger',
    asap: 'Lo antes posible',
    asapReady: (time: string): string => `Listo cerca de las ${time}`,
    pickTime: 'Elige una hora',
    today: 'Hoy',
    tomorrow: 'Mañana',
    noSlotsTitle: 'No hay horarios disponibles',
    noSlotsBody: 'Esta sucursal no tiene horarios libres ahora. Intenta más tarde.',
    closedTitle: 'La sucursal está cerrada',
    closedBody: 'Los pedidos se abren otra vez en horario de servicio.',
    full: 'Lleno',
    summary: 'Resumen del pedido',
    subtotal: 'Total',
    taxNote: 'Precios con IVA incluido. Todavía no se te cobra nada.',
    placeOrder: 'Hacer pedido',
    placing: 'Enviando tu pedido…',
    orderFailed: 'No se pudo hacer tu pedido',
    noteForStore: '¿Algo más que debamos saber?',
    noteplaceholder: 'Opcional',
    slotTaken: 'Ese horario se acaba de llenar. Elige otro.',
    cartChanged: 'Tu carrito cambió. Revísalo antes de continuar.',
    // Pago en mostrador (sucursales sin cobro en linea).
    payAtCounterTitle: 'Pagas al recoger',
    payAtCounterBody: 'En efectivo, con tarjeta o por transferencia, directamente en el mostrador.',
  },

  payment: {
    title: 'Pago',
    // El aviso de simulacion no es un detalle: mientras el cobro sea de
    // mentira, decir "pagado" a secas seria mentir.
    simulatedTitle: 'Pago simulado',
    simulatedBody:
      'Esta versión no tiene un medio de pago conectado. No se usa ninguna tarjeta y no se mueve dinero.',
    simulatedShort: 'Simulado · no se movió dinero',
    amountDue: 'Total a pagar',
    subtotalNote: 'Precios con IVA incluido.',
    method: 'Tarjeta de prueba',
    methodNote: 'Elige cómo se comporta la tarjeta de prueba.',
    approve: 'Aprueba el pago',
    declineCard: 'Rechaza · tarjeta rechazada',
    declineFunds: 'Rechaza · fondos insuficientes',
    pay: (amount: string): string => `Pagar ${amount}`,
    paying: 'Procesando…',
    payLater: 'Ahora no',
    payNow: 'Completar el pago',
    retry: 'Intentar el pago otra vez',
    declinedTitle: 'El pago fue rechazado',
    declined: {
      card_declined: 'La tarjeta fue rechazada. Prueba con otra.',
      insufficient_funds: 'La tarjeta no tiene fondos suficientes.',
      declined: 'El pago no pasó.',
    },
    // El caso que importa: el dinero se movio y no lo pudimos guardar.
    // Reintentar aqui NO vuelve a cobrar, y hay que decirlo.
    unrecordedTitle: 'Se cobró, pero no lo pudimos guardar',
    unrecordedBody:
      'El pago pasó, pero no lo pudimos registrar y el pedido todavía no está confirmado. Terminar esto no te vuelve a cobrar.',
    finishSaving: 'Terminar de guardar el pago',
    saving: 'Guardando…',
    // Distinto del anterior: aqui reintentar no arregla nada, y ofrecer
    // un boton de reintento seria mandar al cliente a un bucle.
    orphanedTitle: 'Se procesó, pero este pedido no lo pudo aceptar',
    orphanedBody:
      'El pago pasó y este pedido no lo pudo tomar. No pagues otra vez. Muestra esta pantalla en el mostrador y lo resolvemos.',
    orphanedRef: (reference: string): string => `Referencia del pago: ${reference}`,
    orderNotPayable: 'Este pedido no está esperando un pago.',
    disabledTitle: 'Los pagos simulados están desactivados aquí',
    disabledBody:
      'Esta sucursal tiene un medio de pago real, así que la app no puede marcar pedidos como pagados por su cuenta.',
    amountMismatch: 'El monto cambió. Vuelve a abrir el pedido e intenta otra vez.',
    conflict: 'Ese intento de pago pertenece a otro pedido.',
    failed: 'No se pudo procesar el pago',
    history: 'Intentos de pago',
    attempt: (status: string, amount: string, when: string): string =>
      `${status} · ${amount} · ${when}`,
    statusLabel: {
      pending: 'Pendiente',
      succeeded: 'Pagado',
      failed: 'Rechazado',
      voided: 'Anulado',
    },
  },

  order: {
    title: 'Tu pedido',
    number: (n: number): string => `Pedido #${n}`,
    pickupCode: 'Código para recoger',
    pickupCodeHint: 'Muestra este código en el mostrador.',
    estimatedFor: (time: string): string => `Estimado para las ${time}`,
    asapEstimate: 'Lo antes posible',
    itemsTitle: 'Productos',
    subtotal: 'Total',
    taxNote: 'Precios con IVA incluido.',
    payAtCounter: 'Pagas en el mostrador al recoger: efectivo, tarjeta o transferencia.',
    placedAt: (when: string): string => `Pedido el ${when}`,
    reorder: 'Pedir otra vez',
    reorderAdded: 'Agregado a tu carrito',
    trackingNote:
      'Aquí verás cuando empecemos a prepararlo y cuando esté para recoger. Las horas son estimadas.',
    notFound: 'No encontramos ese pedido.',
    simulatedConfirmed: 'Confirmado con un pago simulado: no se movió dinero.',
    payPending: 'Termina el pago para enviar este pedido a la tienda.',
    // Etiquetas de estado. No se dice "listo" hasta que el negocio lo
    // marque como tal (`ready`): antes seria prometer algo que no sabemos.
    status: {
      draft: 'Borrador',
      payment_pending: 'Esperando el pago',
      payment_failed: 'El pago falló',
      confirmed: 'Pedido recibido',
      preparing: 'En preparación',
      ready: 'Ya puedes recogerlo',
      completed: 'Entregado',
      canceled: 'Cancelado',
      refunded: 'Reembolsado',
    },
    statusHint: {
      draft: 'Este pedido todavía no se ha enviado.',
      payment_pending: 'Esperamos a que pase el pago. Todavía no hay nada en firme.',
      payment_failed: 'El pago no pasó, así que el pedido no llegó a la tienda.',
      confirmed: 'La tienda ya tiene tu pedido.',
      preparing: 'Estamos preparando tu pedido.',
      ready: 'Pasa al mostrador con tu código.',
      completed: 'Gracias por tu visita.',
      canceled: 'Este pedido se canceló.',
      refunded: 'Este pedido se reembolsó.',
    },
  },

  orders: {
    title: 'Pedidos',
    signInTitle: 'Inicia sesión para ver tus pedidos',
    signInBody: 'Tu historial se guarda en tu cuenta. Puedes crear una desde Perfil.',
    emptyTitle: 'Aún no tienes pedidos',
    emptyBody: 'Cuando hagas tu primer pedido aparecerá aquí con su código para recoger.',
    active: 'En curso',
    past: 'Anteriores',
    itemsCount: (count: number): string => (count === 1 ? '1 producto' : `${count} productos`),
  },

  rewards: {
    title: 'Puntos',
    yourPoints: 'Tus puntos',
    signInPrompt: 'Inicia sesión desde Perfil para empezar a juntar puntos.',
    inactive: (brand: string): string => `El programa de puntos no está activo en ${brand}.`,
    earnRate: (perDollar: number, minRedeem: number): string =>
      `Ganas ${perDollar} punto(s) por cada peso. Necesitas ${minRedeem} para canjear.`,
    perVisit: (points: number): string =>
      `Ganas ${points} puntos en cada visita: enséñale tu QR al cajero.`,
    scan: 'Escanear QR del local',
    catalog: 'Recompensas',
    empty: 'Todavía no hay recompensas.',
    points: (n: number): string => `${n} pts`,
    redeem: 'Canjear',
    missing: (n: number): string => `Te faltan ${n} pts`,
    confirmRedeem: (name: string, cost: number): string => `¿Canjear ${name} por ${cost} puntos?`,
    confirm: 'Sí, canjear',
    redeemFailed: 'No se pudo canjear',
    notEnough: 'Todavía no te alcanzan los puntos.',
    notAvailable: 'Esa recompensa ya no está disponible.',
    activeTitle: 'Tus canjes',
    showCode: 'Muestra este código en el mostrador para recibirlo.',
    cancelRedemption: 'Cancelar y recuperar mis puntos',
    used: 'Entregado',
    footnote: 'Los puntos son personales y no se pueden transferir.',
    myCard: 'Mi tarjeta',
    myCardHint: 'Enséñale este QR al cajero para sumar tu visita o recibir tu recompensa.',
    qrRefresh: (seconds: number): string => `Se renueva en ${seconds} s`,
    qrError: 'No se pudo mostrar tu QR. Revisa tu internet.',
    ready: (reward: string): string => `¡Ya juntaste para: ${reward}!`,
    readyHint: 'Enséñale tu QR al cajero y te la entrega.',
    goal: (missing: number, reward: string): string => `Te faltan ${missing} pts para ${reward}`,
    askCashier: 'Pídela en el mostrador',
    orScan: 'O escanea el QR del local',
  },

  visit: {
    title: 'Registrar visita',
    signInTitle: 'Inicia sesión para sumar tu visita',
    signInBody: 'Los puntos se guardan en tu cuenta. Si no tienes una, créala en un minuto.',
    claiming: 'Sumando tu visita…',
    successTitle: (points: number): string => `¡+${points} puntos!`,
    successBody: (balance: number): string => `Ahora tienes ${balance} puntos.`,
    nextVisit: (when: string): string => `Tu siguiente visita cuenta a partir de: ${when}`,
    tooSoonTitle: 'Ya registraste tu visita',
    tooSoonBody: (when: string): string => `Puedes volver a sumar a partir de: ${when}`,
    tooSoonNoDate: 'Puedes volver a sumar en tu próxima visita.',
    invalidTitle: 'Este QR ya no es válido',
    invalidBody: 'Pide en el mostrador el QR actual y vuelve a escanearlo.',
    disabledTitle: 'El programa de puntos no está activo',
    disabledBody: 'Por ahora no se están sumando puntos. Pregunta en el mostrador.',
    badLinkTitle: 'Este enlace no es un QR de visita',
    seeRewards: 'Ver recompensas',
    failed: 'No se pudo registrar la visita',
  },

  payments: {
    choose: '¿Cómo vas a pagar?',
    methods: {
      cash: 'Efectivo',
      card_counter: 'Tarjeta en mostrador',
      transfer: 'Transferencia',
      mercadopago: 'Mercado Pago',
      stripe: 'Tarjeta en línea (Stripe)',
      clip: 'Clip',
    } as Record<string, string>,
    hints: {
      cash: 'Pagas al recoger.',
      card_counter: 'Débito o crédito, al recoger.',
      transfer: 'Al hacer tu pedido te damos la CLABE y el monto exacto.',
      mercadopago: 'Tarjeta, saldo de Mercado Pago u OXXO. Al hacer tu pedido te damos el botón para pagar.',
    } as Record<string, string>,
    transferData: 'Datos para transferir',
    bank: 'Banco',
    holder: 'A nombre de',
    clabe: 'CLABE',
    amount: 'Monto',
    concept: 'Concepto',
    conceptValue: (orderNumber: string): string => `Pedido ${orderNumber}`,
    copy: 'Copiar',
    copied: 'Copiado',
    payTitle: 'Paga tu pedido',
    transferSteps: 'Transfiere el monto exacto desde la app de tu banco y enseña el comprobante al recoger.',
    mpButton: (amount: string): string => `Pagar ${amount} con Mercado Pago`,
    mpSteps: (amount: string, orderNumber: string): string =>
      `Se abre Mercado Pago. Paga ${amount} y en la nota escribe "Pedido ${orderNumber}". Enseña el comprobante al recoger.`,
    mpAutoSteps: 'Se abre Mercado Pago con el total de tu pedido. Al terminar de pagar, tu pedido se marca como pagado solo.',
    mpAutoPending: 'Si ya pagaste, en unos segundos se marca como pagado.',
    mpOpening: 'Abriendo Mercado Pago…',
    mpErrors: {
      ya_pagado: 'Este pedido ya está pagado.',
      pedido_cerrado: 'Este pedido ya se cerró.',
      mercadopago_no_conectado: 'Mercado Pago no está disponible ahora. Paga en el mostrador.',
    } as Record<string, string>,
    mpFailed: 'No se pudo abrir Mercado Pago. Intenta de nuevo o paga en el mostrador.',
    pending: 'Pago por confirmar',
    pendingHint: 'El negocio lo marca en cuanto vea tu pago.',
    confirmed: 'Pago recibido',
    payWith: (method: string): string => `Pagas con: ${method}`,
    unavailable: 'Esa forma de pago ya no está disponible. Elige otra.',
    none: 'Por ahora no hay formas de pago activas. Pregunta en el mostrador.',
  },

  stories: {
    title: 'Historias',
    open: (caption: string): string => `Ver historia ${caption}`,
    untitled: 'Novedad',
    empty: 'No hay historias por ahora.',
    order: 'Pedir',
    previous: 'Historia anterior',
    next: 'Siguiente historia',
    videoWebOnly: 'Este video se ve en la versión web de la app.',
  },

  install: {
    title: 'Instala la app',
    body: 'Tenla en tu pantalla de inicio: pide más rápido y junta puntos.',
    install: 'Instalar app',
    howTo: 'Cómo instalarla',
    later: 'Ahora no',
    close: 'Cerrar',
    iosSteps: [
      { icon: 'share-outline', text: 'Toca Compartir abajo en Safari (el cuadro con la flecha hacia arriba).' },
      { icon: 'add-circle-outline', text: 'Baja y toca “Agregar a pantalla de inicio”.' },
      { icon: 'checkmark-circle-outline', text: 'Toca “Agregar”. Listo: VIVA queda junto a tus apps.' },
    ],
    androidSteps: [
      { icon: 'ellipsis-vertical', text: 'Toca el menú de 3 puntos arriba a la derecha en Chrome.' },
      { icon: 'download-outline', text: 'Toca “Instalar app” (o “Agregar a pantalla principal”).' },
      { icon: 'checkmark-circle-outline', text: 'Confirma con “Instalar”. Listo.' },
    ],
    inAppTitle: 'Ábrela en tu navegador para instalarla',
    inAppIos: 'Toca los 3 puntos o el ícono de compartir y elige “Abrir en Safari”.',
    inAppAndroid: 'Toca los 3 puntos arriba y elige “Abrir en Chrome”.',
    copy: 'Copiar liga',
    copied: 'Liga copiada. Pégala en Safari o Chrome.',
  },

  scanner: {
    title: 'Escanear QR',
    hint: 'Apunta al QR del mostrador.',
    starting: 'Abriendo la cámara…',
    denied: 'La app no tiene permiso para usar la cámara. Actívalo en los ajustes del navegador y vuelve a intentar.',
    unavailable: 'Este navegador no puede usar la cámara aquí. Abre el QR con la cámara de tu teléfono.',
    nativeOnly: 'Escanea el QR con la cámara de tu teléfono: se abrirá la app en la pantalla de visita.',
    notVisit: 'Ese QR no es el de visitas de la tienda.',
  },

  push: {
    title: 'Avisos de tu pedido',
    body: 'Te avisamos cuando empecemos a preparar tu pedido.',
    enable: 'Activar avisos',
    enabling: 'Un momento…',
    on: 'Los avisos están activos',
    onBody: 'Te llegará un aviso en este teléfono cuando tu pedido avance.',
    // Android 13+ solo ensena el dialogo una vez; despues, Ajustes.
    blocked: 'Los avisos están desactivados',
    blockedBody:
      'Antes dijiste que no, así que Android no volverá a preguntar. Puedes activarlos en Ajustes del teléfono → Apps → VIVA → Notificaciones.',
    signInFirst: 'Inicia sesión para recibir avisos de tus pedidos.',
    unsupported: {
      'no-device': 'Los avisos necesitan un teléfono real; esto parece un emulador.',
      'no-fcm': 'Esta versión no trae la configuración de Firebase, así que no puede recibir avisos.',
      'no-project': 'A esta versión le falta el id del proyecto de Expo, así que no puede recibir avisos.',
      web: 'En la versión web no hay avisos. Puedes seguir tu pedido desde la pestaña Pedidos.',
    },
    failed: 'No pudimos activar los avisos',
  },

  profile: {
    title: 'Perfil',
    customer: 'Cliente',
    location: 'Sucursal',
    timezone: (tz: string): string => `Zona horaria: ${tz}`,
    changeStore: 'Cambiar sucursal',
    cart: 'Carrito',
    cartEmpty: 'Vacío',
    cartCount: (count: number): string => `${count} producto(s) guardados en este dispositivo.`,
    footnote: 'Esta app solo usa la clave pública de Supabase. Los datos sensibles viven en el servidor.',
    adminTitle: 'Panel del negocio',
    adminBody: 'Pedidos, menú, precios, fotos y horarios.',
    adminOpen: 'Abrir el panel',
  },

  notFound: {
    title: 'Esta pantalla no existe',
    body: 'El enlace que seguiste no lleva a ningún lado.',
    goHome: 'Volver al inicio',
  },

  /**
   * Copia de los estados de error. `classifyError` decide el TIPO; el
   * texto vive aqui, para que se traduzca con todo lo demas.
   */
  dataError: {
    config: {
      title: 'La app no está configurada',
      message: 'Esta versión no tiene las credenciales de Supabase.',
      hint: 'Copia apps/mobile/.env.example a .env.local y llena la URL y la clave pública.',
    },
    badKey: {
      title: 'Clave de Supabase equivocada',
      hint: 'Usa la clave pública (sb_publishable_…), nunca la secreta.',
    },
    auth: {
      title: 'Credenciales rechazadas',
      message: 'Supabase no aceptó la clave de esta versión.',
      hint: 'Puede que la clave haya cambiado. Hay que volver a publicar con la clave pública actual.',
    },
    permission: {
      title: 'Sin permiso para ver esto',
      message: 'La base de datos rechazó la consulta por permisos.',
      hint: 'Suele ser un GRANT o una política de RLS que falta. Revisa las migraciones 0004, 0006 y 0020.',
    },
    offline: {
      title: 'Sin conexión',
      message: 'No pudimos llegar al servidor.',
      hint: 'Revisa que tengas internet e intenta otra vez.',
    },
    notFound: {
      title: 'Falta parte de la base de datos',
      message: 'La base no tiene la tabla o vista que la app está pidiendo.',
      hint: 'Aplica las migraciones con `pnpm db:push`.',
    },
    server: {
      title: 'Falló el servidor',
      message: 'Supabase devolvió un error interno.',
      hint: 'Suele ser temporal. Intenta otra vez en un momento.',
    },
    unknown: {
      title: 'Algo salió mal',
      message: 'No pudimos cargar esto.',
      hint: 'Si vuelve a pasar, mándanos una captura de esta pantalla.',
    },
  },
} as const;

export type Strings = typeof strings;
