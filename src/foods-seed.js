// Seed food database. All values per 100 g of the food as listed (cooked unless noted).
// roles: which meal slots the food can fill. tags: allergen tags. veg: vegetarian-friendly.
// step: rounding step in grams. max: largest sensible portion in grams. unit: optional countable unit.
// The admin can add or edit foods in the app; these are just the starting set.

const F = (id, name, cat, kcal, p, c, f, roles, o = {}) => ({
  id, name, cat, kcal, p, c, f, roles,
  tags: o.tags ?? [], veg: o.veg ?? false, step: o.step ?? 5, max: o.max ?? 500, unit: o.unit ?? null,
});

export const FOODS = [
  // Main proteins
  F('chicken-breast', 'Chicken breast, grilled', 'protein', 165, 31, 0, 3.6, ['mainProtein'], { step: 10 }),
  F('turkey-breast', 'Turkey breast, cooked', 'protein', 135, 30, 0, 1, ['mainProtein'], { step: 10 }),
  F('beef-lean', 'Beef, lean, cooked', 'protein', 217, 26, 0, 12, ['mainProtein'], { step: 10, max: 300 }),
  F('tilapia', 'Tilapia, cooked', 'protein', 128, 26, 0, 2.7, ['mainProtein'], { step: 10, tags: ['fish'] }),
  F('salmon', 'Salmon, cooked', 'protein', 206, 22, 0, 12, ['mainProtein'], { step: 10, max: 300, tags: ['fish'] }),
  F('tuna-canned', 'Tuna, canned in water', 'protein', 116, 26, 0, 1, ['mainProtein'], { step: 10, max: 300, tags: ['fish'] }),
  // 'vegMain' foods are used as the main protein for vegetarians, or when the user marks them as liked.
  F('lentils', 'Lentils, cooked (ads)', 'protein', 116, 9, 20, 0.4, ['vegMain', 'carb'], { veg: true, max: 400 }),
  F('chickpeas', 'Chickpeas, cooked (hummus beans)', 'protein', 164, 8.9, 27, 2.6, ['vegMain', 'carb'], { veg: true, max: 350 }),
  F('tofu', 'Tofu, firm', 'protein', 76, 8, 1.9, 4.8, ['vegMain'], { veg: true, max: 400, tags: ['soy'] }),

  // Breakfast proteins (many are Egyptian staples)
  F('eggs', 'Whole eggs', 'protein', 143, 12.6, 0.7, 9.5, ['bfProtein'], { veg: true, step: 50, max: 250, tags: ['egg'], unit: { g: 50, name: 'egg' } }),
  F('egg-whites', 'Egg whites', 'protein', 52, 10.9, 0.7, 0.2, ['bfProtein', 'boost'], { veg: true, step: 30, max: 300, tags: ['egg'] }),
  F('ful-medames', 'Ful medames, cooked', 'protein', 110, 7.6, 19.6, 0.4, ['bfProtein', 'vegMain'], { veg: true, max: 400 }),
  F('taameya', 'Taameya (falafel), fried', 'protein', 333, 13.3, 31.8, 17.8, ['bfProtein', 'vegMain'], { veg: true, max: 150, tags: ['sesame'] }),
  F('white-cheese', 'White cheese (gebna beida)', 'dairy', 264, 14, 4, 21, ['bfProtein'], { veg: true, max: 60, tags: ['dairy'] }),
  F('plain-yogurt', 'Plain yogurt (zabadi)', 'dairy', 61, 3.5, 4.7, 3.3, ['bfProtein', 'snack'], { veg: true, max: 350, tags: ['dairy'] }),

  // Snack / boost proteins
  F('whey', 'Whey protein powder', 'protein', 400, 80, 8, 6, ['snack', 'boost'], { veg: true, max: 60, tags: ['dairy'] }),
  F('milk', 'Milk, whole', 'dairy', 62, 3.3, 4.8, 3.3, ['snack'], { veg: true, max: 400, tags: ['dairy'], step: 10 }),

  // Carbs
  F('white-rice', 'White rice, cooked', 'carb', 130, 2.7, 28, 0.3, ['carb'], { veg: true, step: 10 }),
  F('pasta', 'Pasta, cooked', 'carb', 158, 5.8, 31, 0.9, ['carb'], { veg: true, step: 10, tags: ['gluten'] }),
  F('bulgur', 'Bulgur, cooked', 'carb', 83, 3, 19, 0.2, ['carb'], { veg: true, step: 10, tags: ['gluten'] }),
  F('potato', 'Potato, boiled', 'carb', 87, 1.9, 20, 0.1, ['carb'], { veg: true, step: 10 }),
  F('sweet-potato', 'Sweet potato, baked', 'carb', 90, 2, 21, 0.2, ['carb'], { veg: true, step: 10 }),
  F('baladi-bread', 'Baladi bread (aish baladi)', 'carb', 270, 9, 55, 1.5, ['bfCarb', 'carb'], { veg: true, step: 35, max: 210, tags: ['gluten'] }),
  F('oats', 'Oats, dry', 'carb', 389, 16.9, 66, 6.9, ['bfCarb'], { veg: true, step: 5, max: 120, tags: ['gluten'] }),

  // Fruit
  F('banana', 'Banana', 'fruit', 89, 1.1, 23, 0.3, ['fruit'], { veg: true, step: 10 }),
  F('apple', 'Apple', 'fruit', 52, 0.3, 14, 0.2, ['fruit'], { veg: true, step: 10 }),
  F('orange', 'Orange', 'fruit', 47, 0.9, 12, 0.1, ['fruit'], { veg: true, step: 10 }),
  F('mango', 'Mango', 'fruit', 60, 0.8, 15, 0.4, ['fruit'], { veg: true, step: 10 }),
  F('dates', 'Dates', 'fruit', 282, 2.5, 75, 0.4, ['fruit'], { veg: true, step: 10, max: 60 }),

  // Vegetables
  F('cucumber', 'Cucumber', 'veg', 15, 0.7, 3.6, 0.1, ['veg'], { veg: true, step: 10 }),
  F('tomato', 'Tomato', 'veg', 18, 0.9, 3.9, 0.2, ['veg'], { veg: true, step: 10 }),
  F('salad-greens', 'Salad greens (lettuce, rocca)', 'veg', 15, 1.4, 2.9, 0.2, ['veg'], { veg: true, step: 10 }),
  F('broccoli', 'Broccoli, steamed', 'veg', 35, 2.4, 7.2, 0.4, ['veg'], { veg: true, step: 10 }),
  F('zucchini', 'Zucchini (koosa), cooked', 'veg', 17, 1.2, 3.1, 0.3, ['veg'], { veg: true, step: 10 }),
  F('carrot', 'Carrot', 'veg', 41, 0.9, 10, 0.2, ['veg'], { veg: true, step: 10 }),

  // Fats
  F('olive-oil', 'Olive oil', 'fat', 884, 0, 0, 100, ['fat'], { veg: true, step: 1, max: 30 }),
  F('tahini', 'Tahini', 'fat', 595, 17, 21, 54, ['fat'], { veg: true, step: 5, max: 30, tags: ['sesame'] }),
  F('peanut-butter', 'Peanut butter', 'fat', 588, 25, 20, 50, ['fat'], { veg: true, step: 5, max: 40, tags: ['peanut'] }),
  F('almonds', 'Almonds', 'fat', 579, 21, 22, 50, ['fat'], { veg: true, step: 5, max: 40, tags: ['nuts'] }),
];

export const ALLERGEN_TAGS = ['egg', 'dairy', 'nuts', 'peanut', 'gluten', 'fish', 'sesame', 'soy'];
