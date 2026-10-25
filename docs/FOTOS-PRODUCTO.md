# Fotos de producto — Viva Freehold

Cómo subir las 50 imágenes sin hacerlo una por una.

---

## Paso 1 — Renombrar

Cada archivo lleva el identificador del producto. La lista completa está abajo.

Formato: **JPG o WEBP**, cuadradas (1:1), **1000×1000 px** o parecido.
Peso ideal: menos de 300 KB cada una. Si vienen de redes sociales,
seguramente ya cumplen.

## Paso 2 — Subirlas todas de golpe

1. Supabase → **Storage** → bucket `menu-images`
2. Crear carpeta: `22222222-2222-4222-8222-222222222222`
   (es el id de la sucursal Freehold)
3. Entrar a esa carpeta
4. **Upload files** y seleccionar las 50 de una vez

## Paso 3 — Conectarlas

Un solo SQL las asocia a los 50 productos. Está al final de este documento.

---

## Los 50 nombres de archivo

### Juices

 1. **Viva Juice** → `SEED-JUICE-VIVA.jpg`
 2. **Green Juice** → `SEED-JUICE-GREEN.jpg`
 3. **Super Detox** → `SEED-JUICE-DETOX.jpg`
 4. **Anti Flu** → `SEED-JUICE-ANTIFLU.jpg`
 5. **Refresh Me** → `SEED-JUICE-REFRESH.jpg`
 6. **Create Your Own Juice** → `SEED-JUICE-CUSTOM.jpg`

### Smoothies

 7. **Viva Berry** → `SEED-SMOOTH-BERRY.jpg`
 8. **Chocolate Protein** → `SEED-SMOOTH-CHOCO.jpg`
 9. **Vanilla Protein** → `SEED-SMOOTH-VANIL.jpg`

### Virgin Drinks

10. **Pina Colada** → `SEED-VIRGIN-PINA.jpg`
11. **Tepache** → `SEED-VIRGIN-TEPACHE.jpg`
12. **Sangria** → `SEED-VIRGIN-SANGRIA.jpg`

### Fruit Water

13. **Fruit Water** → `SEED-WATER-FRUIT.jpg`

### Viva Boost Shots

14. **Ginger Shot** → `SEED-SHOT-GINGER.jpg`
15. **Turmeric Shot** → `SEED-SHOT-TURMERIC.jpg`
16. **Pomegranate Shot** → `SEED-SHOT-POMEGR.jpg`

### Bowls

17. **Acai Bowl** → `SEED-BOWL-ACAI.jpg`
18. **Pitaya Bowl** → `SEED-BOWL-PITAYA.jpg`
19. **Coconut Bowl** → `SEED-BOWL-COCONUT.jpg`
20. **Create Your Own Bowl** → `SEED-BOWL-CUSTOM.jpg`

### Iced Coffee

21. **Iced Latte** → `SEED-ICED-LATTE.jpg`
22. **Iced Americano** → `SEED-ICED-AMERICANO.jpg`
23. **Cold Brew** → `SEED-ICED-COLDBREW.jpg`
24. **Viva Frappe** → `SEED-ICED-FRAPPE.jpg`
25. **Iced Matcha** → `SEED-ICED-MATCHA.jpg`

### Hot Coffee

26. **Fresh Brew Coffee** → `SEED-HOT-BREW.jpg`
27. **Americano** → `SEED-HOT-AMERICANO.jpg`
28. **Cappuccino** → `SEED-HOT-CAPPUCCINO.jpg`
29. **Latte** → `SEED-HOT-LATTE.jpg`
30. **Hot Matcha** → `SEED-HOT-MATCHA.jpg`
31. **Single Shot** → `SEED-HOT-SINGLE.jpg`
32. **Double Shot** → `SEED-HOT-DOUBLE.jpg`
33. **Affogato** → `SEED-HOT-AFFOGATO.jpg`

### Viva Bites

34. **Tuna Sandwich** → `SEED-BITE-TUNA.jpg`
35. **Smoked Salmon Sandwich** → `SEED-BITE-SALMON.jpg`
36. **Guacamole** → `SEED-BITE-GUAC.jpg`

### Crepes & Waffles

37. **Viva Crepe** → `SEED-CREPE-VIVA.jpg`
38. **Viva Waffle** → `SEED-WAFFLE-VIVA.jpg`

### Fresh Fruit Cup

39. **Fresh Fruit Cup 10 oz** → `SEED-CUP-10.jpg`
40. **Fresh Fruit Cup 12 oz** → `SEED-CUP-12.jpg`

### Treats

41. **Gelatin (Water-Based)** → `SEED-TREAT-GELWATER.jpg`
42. **Gelatin (Milk-Based)** → `SEED-TREAT-GELMILK.jpg`
43. **Three Milk Cake** → `SEED-TREAT-TRESLECHE.jpg`
44. **Carrot Cake Slice** → `SEED-TREAT-CARROT.jpg`
45. **Tiramisu Cake Slice** → `SEED-TREAT-TIRAMISU.jpg`
46. **Lemon Cake Slice** → `SEED-TREAT-LEMON.jpg`
47. **Banana Split** → `SEED-TREAT-BANSPLIT.jpg`
48. **Mango Chili Sorbet** → `SEED-TREAT-SORBET.jpg`

### Ice Cream

49. **Ice Cream Cup** → `SEED-ICE-CUP.jpg`
50. **Ice Cream Cone** → `SEED-ICE-CONE.jpg`
---

## SQL para conectarlas

Copiar en el SQL Editor y ejecutar **después** de subir las imágenes.
Sustituir `TU-PROYECTO` por el subdominio real del proyecto de Supabase.

```sql
-- Conecta las 50 fotos de una sola vez, derivando la URL del
-- clover_item_id. Idempotente: se puede repetir sin duplicar.
insert into public.app_item_overrides (store_id, clover_item_id, image_url)
select
  i.store_id,
  i.clover_item_id,
  'https://TU-PROYECTO.supabase.co/storage/v1/object/public/menu-images/'
    || i.store_id || '/' || i.clover_item_id || '.jpg'
from public.catalog_items i
where i.store_id = '22222222-2222-4222-8222-222222222222'
  and i.deleted_at is null
on conflict (store_id, clover_item_id) do update
  set image_url = excluded.image_url;

-- Verificación: deben salir 50 con imagen
select count(*) filter (where image_url is not null) as con_imagen,
       count(*) as total
from public.app_item_overrides
where store_id = '22222222-2222-4222-8222-222222222222';
```

Si las subes en **webp** en lugar de jpg, cambiar `.jpg'` por `.webp'`
en la línea de la URL.

---

## Comprobar que se ven

Abrir cualquiera de estas URLs en el navegador; debe mostrar la foto:

```
https://TU-PROYECTO.supabase.co/storage/v1/object/public/menu-images/22222222-2222-4222-8222-222222222222/SEED-BOWL-ACAI.jpg
```

Si da error 400 o 404, revisar que el nombre del archivo coincida
exactamente, mayúsculas incluidas.
