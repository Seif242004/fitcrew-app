// More diet foods (session 13): the everyday dietary staples dietitians use worldwide and in Egypt,
// so plans and swaps ("بدائل") have more real choices. Nothing niche (no tofu, tempeh, seitan,
// exotic grains or imported specialities nobody buys here).
//
// Same format and rules as foods-seed.js: values per 100 g AS EATEN (cooked weight for cooked
// foods), USDA FoodData Central (SR Legacy / Foundation) for single ingredients, Egyptian home and
// bakery foods estimated from common recipes and marked est: true.
//   roles  set  -> the plan generator may use it (only through a template slot or a role slot)
//   roles  []   -> a real diet food for logging and swaps, never put in a plan by itself
// `m` adds household measures for logging ([name, plural, grams, half]), merged in measures.js.

const F = (id, name, ar, cat, kcal, p, c, f, roles, o = {}) => ({
  id, name, ar, cat, kcal, p, c, f, roles,
  tags: o.tags ?? [], veg: o.veg ?? false, step: o.step ?? 5,
  max: o.portion ? o.portion[2] : (o.max ?? 500), portion: o.portion ?? null, unit: o.unit ?? null, est: o.est ?? false, raw: o.raw ?? null,
  measures: o.m ?? [],
});
const M = (name, plural, g, half = true) => [name, plural, g, half];
const V = { veg: true };

export const MORE_DIET_FOODS = [
  // ---------------------------------------------------------------- poultry & meat
  F('chicken-breast-boiled', 'Chicken breast, boiled', 'صدور فراخ مسلوقة', 'protein', 151, 30.5, 0, 3.2, ['mainProtein'], { tags: ['poultry'], step: 10, portion: [120, 170, 250], m: [M('fillet', 'fillets', 150)] }),
  F('chicken-drumstick', 'Chicken drumstick, grilled, skinless', 'وراك فراخ (دبوس) مشوي', 'protein', 172, 28.3, 0, 5.7, ['mainProtein'], { tags: ['poultry'], step: 10, portion: [120, 170, 250], m: [M('drumstick', 'drumsticks', 75, false)] }),
  F('chicken-breast-pan', 'Chicken breast, pan-cooked with a little oil', 'صدور فراخ سوتيه', 'protein', 187, 29, 1, 7, [], { tags: ['poultry'], step: 10, est: true, m: [M('fillet', 'fillets', 150)] }),
  F('chicken-kofta', 'Chicken kofta, grilled', 'كفتة فراخ مشوية', 'protein', 170, 21, 4, 8, ['mainProtein'], { tags: ['poultry'], step: 10, portion: [100, 150, 220], est: true, m: [M('kofta finger', 'kofta fingers', 40, false)] }),
  F('chicken-shawarma-meat', 'Chicken shawarma meat, home-made (little oil)', 'شاورما فراخ بيتي', 'protein', 175, 25, 3, 7, ['mainProtein'], { tags: ['poultry', 'dairy'], step: 10, portion: [120, 160, 230], est: true }),
  F('turkey-mince', 'Turkey mince, lean, cooked', 'لحم رومي مفروم', 'protein', 172, 27.4, 0, 6.9, [], { tags: ['poultry', 'pricey'], step: 10 }),
  F('beef-mince-lean', 'Minced beef, extra lean (95%), cooked', 'لحمة مفرومة قليلة الدهن', 'protein', 193, 29, 0, 7.6, ['mainProtein'], { tags: ['meat'], step: 10, portion: [100, 140, 200] }),
  F('rosto', 'Roast beef (rosto), lean', 'روستو', 'protein', 170, 29, 0, 5.5, ['mainProtein'], { tags: ['meat'], step: 10, portion: [100, 150, 220], est: true, m: [M('slice', 'slices', 30, false)] }),
  F('beef-boiled', 'Beef, lean, boiled (lahma maslouka)', 'لحمة مسلوقة', 'protein', 200, 30, 0, 8.5, ['mainProtein'], { tags: ['meat'], step: 10, portion: [100, 150, 220], est: true, m: [M('piece', 'pieces', 40, false)] }),
  F('veal', 'Veal (betello), lean, grilled', 'لحم بتلو مشوي', 'protein', 172, 30, 0, 5, [], { tags: ['meat', 'pricey'], step: 10 }),
  F('lamb-chops', 'Lamb chops, grilled, lean', 'ريش ضاني مشوية', 'protein', 216, 29, 0, 10.5, [], { tags: ['meat', 'pricey'], step: 10, m: [M('chop', 'chops', 45, false)] }),
  F('rabbit', 'Rabbit, roasted', 'أرانب', 'protein', 197, 29.1, 0, 8.1, [], { step: 10 }),
  F('duck-skinless', 'Duck, roasted, skinless', 'بط بدون جلد', 'protein', 201, 23.5, 0, 11.2, [], { tags: ['poultry'], step: 10 }),
  F('pigeon', 'Pigeon (hamam), grilled', 'حمام مشوي', 'protein', 213, 25, 0, 12.5, [], { tags: ['poultry', 'pricey'], step: 10, est: true, m: [M('pigeon', 'pigeons', 180, false)] }),
  F('chicken-gizzards', 'Chicken gizzards, cooked', 'قوانص فراخ', 'protein', 154, 30.4, 0, 2.7, [], { tags: ['poultry', 'organ'], step: 10 }),
  F('turkey-ham', 'Turkey ham slices (lean deli)', 'شرائح رومي لانشون لايت', 'protein', 110, 17, 3, 3.3, [], { tags: ['poultry'], step: 10, unit: { g: 20, name: 'slice' }, est: true }),

  // ---------------------------------------------------------------- fish & seafood
  F('white-fish', 'White fish fillet (cod, hake or fillet), baked', 'فيليه سمك أبيض مشوي', 'protein', 105, 22.8, 0, 0.9, ['mainProtein'], { tags: ['fish'], step: 10, portion: [150, 200, 300], m: [M('fillet', 'fillets', 140)] }),
  F('tuna-steak', 'Tuna steak, grilled', 'ستيك تونة مشوي', 'protein', 130, 29, 0, 0.6, [], { tags: ['fish', 'pricey'], step: 10 }),
  F('sardines-grilled', 'Sardines, fresh, grilled', 'سردين طازج مشوي', 'protein', 185, 24, 0, 10, [], { tags: ['fish'], step: 10, est: true }),
  F('salmon-canned', 'Salmon, canned, drained', 'سالمون معلب', 'protein', 167, 23.1, 0, 7.3, [], { tags: ['fish', 'pricey'], step: 10, m: [M('can', 'cans', 140)] }),
  F('tuna-light', 'Tuna in water, light (flakes)', 'تونة قطع مياه', 'protein', 90, 20, 0, 1, [], { tags: ['fish'], step: 10, est: true, m: [M('can', 'cans', 120)] }),
  F('crab', 'Crab, cooked', 'كابوريا', 'protein', 97, 19.4, 0, 1.5, [], { tags: ['seafood', 'pricey'], step: 10 }),
  F('mussels', 'Mussels (gandofli), cooked', 'جندوفلي', 'protein', 172, 23.8, 7.4, 4.5, [], { tags: ['seafood'], step: 10 }),
  F('herring-smoked', 'Smoked herring (renga)', 'رنجة مدخنة', 'protein', 217, 24.6, 0, 12.4, [], { tags: ['fish'], step: 10, m: [M('fillet', 'fillets', 60, false)] }),

  // ---------------------------------------------------------------- eggs & dairy
  F('egg-poached', 'Eggs, poached', 'بيض بوشيه', 'protein', 143, 12.5, 0.7, 9.5, [], { tags: ['egg'], ...V, unit: { g: 50, name: 'egg' } }),
  F('shakshuka', 'Shakshuka (eggs in tomato, little oil)', 'شكشوكة', 'protein', 95, 6, 4.5, 6, [], { tags: ['egg'], ...V, step: 10, est: true, m: [M('pan (2 eggs)', 'pans (2 eggs)', 250)] }),
  F('greek-yogurt-full', 'Greek yogurt, full-fat', 'زبادي يوناني كامل الدسم', 'dairy', 97, 9, 4, 5, [], { tags: ['dairy'], ...V, step: 10, m: [M('cup', 'cups', 170)] }),
  F('yogurt-light', 'Yogurt, low-fat (zabadi light)', 'زبادي لايت', 'dairy', 63, 5.3, 7, 1.6, ['bfProtein', 'snack'], { tags: ['dairy'], ...V, step: 10, portion: [105, 210, 315], unit: { g: 105, name: 'cup' } }),
  F('cottage-light', 'Cottage cheese, low-fat (1%)', 'جبنة قريش لايت', 'dairy', 72, 12.4, 2.7, 1, ['bfProtein', 'snack'], { tags: ['dairy'], ...V, step: 10, portion: [80, 150, 220], m: [M('tbsp', 'tbsp', 25, false), M('cup', 'cups', 220)] }),
  F('ricotta', 'Ricotta, part-skim', 'جبنة ريكوتا', 'dairy', 138, 11.4, 5.1, 7.9, [], { tags: ['dairy', 'pricey'], ...V, step: 10, m: [M('tbsp', 'tbsp', 30, false)] }),
  F('mozzarella-light', 'Mozzarella, light', 'موتزاريلا لايت', 'dairy', 200, 25, 3, 10, [], { tags: ['dairy'], ...V, step: 10, est: true, unit: { g: 20, name: 'slice' } }),
  F('cheese-triangle-light', 'Spreadable cheese triangle, light', 'جبنة مثلثات لايت', 'dairy', 150, 12, 6, 8.5, ['bfProtein'], { tags: ['dairy'], ...V, step: 17.5, portion: [35, 52.5, 70], unit: { g: 17.5, name: 'triangle' }, est: true }),
  F('cheese-slice-light', 'Processed cheese slice, light', 'جبنة شرائح لايت', 'dairy', 200, 20, 7, 10, [], { tags: ['dairy'], ...V, unit: { g: 20, name: 'slice' }, est: true }),
  F('feta-light', 'Feta / Istanbuli cheese, light', 'جبنة فيتا لايت', 'dairy', 180, 16, 4, 11, [], { tags: ['dairy'], ...V, step: 10, est: true, m: [M('slice', 'slices', 30, false)] }),
  F('milk-low-fat', 'Milk, low-fat (1.5%)', 'لبن نصف دسم', 'dairy', 46, 3.4, 4.9, 1.5, ['snack', 'bfCarb'], { tags: ['dairy'], ...V, step: 10, portion: [150, 250, 400], m: [M('cup', 'cups', 250)] }),
  F('kefir', 'Kefir / fermented milk drink, low-fat', 'كفير', 'dairy', 41, 3.8, 4.5, 0.9, [], { tags: ['dairy'], ...V, step: 10, m: [M('cup', 'cups', 250)] }),
  F('almond-milk', 'Almond milk, unsweetened', 'لبن لوز بدون سكر', 'dairy', 15, 0.6, 0.6, 1.2, [], { tags: ['nuts', 'pricey'], ...V, step: 10, m: [M('cup', 'cups', 250)] }),
  F('protein-shake-rtd', 'Protein shake, ready to drink', 'بروتين شيك جاهز', 'dairy', 60, 8, 4, 1.3, [], { tags: ['dairy', 'pricey'], ...V, step: 10, unit: { g: 330, name: 'bottle' }, est: true }),
  F('whey-isolate', 'Whey protein isolate', 'واي بروتين أيزوليت', 'protein', 370, 88, 3, 1, [], { tags: ['dairy', 'pricey'], ...V, unit: { g: 30, name: 'scoop' }, est: true }),
  F('protein-pudding', 'High-protein pudding / yogurt cup', 'بودينج بروتين', 'dairy', 80, 10, 6, 1.5, [], { tags: ['dairy', 'pricey'], ...V, unit: { g: 200, name: 'cup' }, est: true }),

  // ---------------------------------------------------------------- legumes
  F('ful-oil', 'Ful medames with oil and cumin (cart style)', 'فول بالزيت', 'legume', 140, 7, 18, 4.5, [], { ...V, step: 10, est: true, m: [M('plate', 'plates', 200)] }),
  F('ful-eskandarani', 'Ful eskandarani (tomato, onion, pepper)', 'فول إسكندراني', 'legume', 130, 6.8, 17, 4, [], { ...V, step: 10, est: true, m: [M('plate', 'plates', 200)] }),
  F('bessara', 'Bessara (fava bean and herb purée)', 'بصارة', 'legume', 110, 6, 14, 3.5, [], { ...V, step: 10, est: true, m: [M('plate', 'plates', 200)] }),
  F('kidney-beans', 'Red kidney beans, cooked', 'فاصوليا حمراء', 'legume', 127, 8.7, 22.8, 0.5, [], { ...V, raw: 2.6, m: [M('cup', 'cups', 175)] }),
  F('black-beans', 'Black beans, cooked', 'فاصوليا سوداء', 'legume', 132, 8.9, 23.7, 0.5, [], { ...V, raw: 2.5, m: [M('cup', 'cups', 170)] }),
  F('lentils-yellow', 'Yellow (split) lentils, cooked', 'عدس أصفر', 'legume', 116, 8, 20.5, 0.4, [], { ...V, raw: 2.8, m: [M('cup', 'cups', 200)] }),
  F('chickpea-salad', 'Chickpea salad (chickpeas, vegetables, lemon)', 'سلطة حمص', 'legume', 110, 5, 15, 3.5, [], { ...V, step: 10, est: true }),
  F('mujaddara', 'Mujaddara (lentils with rice or bulgur)', 'مجدرة', 'legume', 150, 5.5, 24, 3.8, [], { ...V, step: 10, est: true, m: [M('plate', 'plates', 250)] }),

  // ---------------------------------------------------------------- breads & breakfast carbs
  F('bran-baladi', 'Bran baladi bread (eish sen / whole wheat)', 'عيش سن (ردة)', 'carb', 245, 10, 47, 2, ['bfCarb', 'carb'], { tags: ['gluten'], ...V, step: 40, portion: [40, 80, 120], unit: { g: 80, name: 'loaf' }, est: true }),
  F('bran-toast', 'Bran / diet toast', 'توست ردة دايت', 'carb', 230, 12, 40, 3.5, ['bfCarb', 'carb'], { tags: ['gluten'], ...V, step: 25, portion: [50, 50, 100], unit: { g: 25, name: 'slice' }, est: true }),
  F('pita-ww', 'Whole-wheat pita', 'عيش شامي بر', 'carb', 262, 9.8, 55, 2.6, ['bfCarb', 'carb'], { tags: ['gluten'], ...V, step: 32, portion: [32, 64, 128], unit: { g: 64, name: 'loaf' } }),
  F('multigrain-bread', 'Multigrain bread', 'خبز حبوب كاملة', 'carb', 265, 13.4, 43, 4.2, [], { tags: ['gluten'], ...V, unit: { g: 30, name: 'slice' } }),
  F('rye-crispbread', 'Crispbread (rye crackers)', 'كريسب بريد', 'carb', 366, 9.4, 77, 1.3, [], { tags: ['gluten'], ...V, unit: { g: 10, name: 'slice' } }),
  F('oatmeal-cooked', 'Oatmeal, cooked with water', 'شوفان مطبوخ بالمية', 'carb', 71, 2.5, 12, 1.5, [], { tags: ['gluten'], ...V, step: 10, m: [M('bowl', 'bowls', 240)] }),
  F('oatmeal-milk', 'Oatmeal, cooked with skimmed milk', 'شوفان باللبن', 'carb', 95, 5.5, 14.5, 1.6, [], { tags: ['gluten', 'dairy'], ...V, step: 10, est: true, m: [M('bowl', 'bowls', 250)] }),
  F('muesli', 'Muesli, no added sugar', 'ميوزلي بدون سكر', 'carb', 360, 10, 66, 6, ['bfCarb'], { tags: ['gluten', 'nuts'], ...V, portion: [30, 45, 60], est: true }),
  F('bran-flakes', 'Bran flakes cereal', 'كورن فليكس ردة', 'carb', 340, 10, 70, 2.5, ['bfCarb'], { tags: ['gluten'], ...V, portion: [30, 40, 60], est: true }),
  F('corn-cakes', 'Corn cakes (thin)', 'كورن كيك', 'carb', 380, 8, 80, 3, [], { ...V, unit: { g: 7, name: 'cake' }, est: true }),

  // ---------------------------------------------------------------- rice, pasta, potatoes, grains
  F('sweet-potato-boiled', 'Sweet potato, boiled', 'بطاطا مسلوقة', 'carb', 76, 1.4, 17.7, 0.1, ['carb'], { ...V, step: 10, portion: [150, 220, 350] }),
  F('mashed-potato', 'Mashed potato (with milk, no butter)', 'بطاطس بيوريه', 'carb', 83, 1.9, 17.6, 0.6, [], { tags: ['dairy'], ...V, step: 10, m: [M('cup', 'cups', 210)] }),
  F('potato-air-fried', 'Potatoes, air-fried', 'بطاطس إير فراير', 'carb', 140, 2.6, 25, 3, [], { ...V, step: 10, est: true }),
  F('barley', 'Barley, cooked', 'شعير مطبوخ', 'carb', 123, 2.3, 28.2, 0.4, [], { tags: ['gluten'], ...V, raw: 3.2 }),
  F('rice-jasmine', 'Jasmine / Egyptian short-grain rice, cooked, no fat', 'رز مصري مسلوق', 'carb', 129, 2.4, 28.5, 0.2, [], { ...V, step: 10, raw: 2.8, m: [M('cup', 'cups', 160)] }),
  F('rice-cooked-ghee', 'Egyptian rice cooked with ghee or oil', 'رز مصري بالسمنة', 'carb', 160, 2.6, 28, 4.2, [], { tags: ['dairy'], ...V, step: 10, raw: 2.6, est: true, m: [M('cup', 'cups', 160)] }),
  F('spaghetti-tomato-light', 'Pasta with tomato sauce (light, home)', 'مكرونة بالصلصة لايت', 'carb', 120, 4.2, 21.5, 2, [], { tags: ['gluten'], ...V, step: 10, est: true, m: [M('plate', 'plates', 300)] }),
  F('corn-on-cob', 'Corn on the cob, grilled (dora)', 'درة مشوي', 'carb', 96, 3.4, 21, 1.5, [], { ...V, unit: { g: 150, name: 'cob' } }),
  F('green-freekeh-soup', 'Freekeh soup', 'شوربة فريك', 'carb', 60, 2.5, 9, 1.5, [], { tags: ['gluten'], ...V, step: 10, est: true, m: [M('bowl', 'bowls', 300)] }),

  // ---------------------------------------------------------------- vegetables & salads
  F('arugula', 'Arugula (gargeer)', 'جرجير', 'veg', 25, 2.6, 3.7, 0.7, ['veg'], { ...V, step: 10, portion: [40, 80, 150], m: [M('bunch', 'bunches', 80)] }),
  F('lettuce', 'Lettuce (khass)', 'خس', 'veg', 15, 1.4, 2.9, 0.2, ['veg'], { ...V, step: 10, portion: [80, 120, 200], m: [M('leaf', 'leaves', 15, false)] }),
  F('celery', 'Celery', 'كرفس', 'veg', 14, 0.7, 3, 0.2, [], { ...V, step: 10, m: [M('stalk', 'stalks', 40, false)] }),
  F('asparagus', 'Asparagus, cooked', 'هليون', 'veg', 22, 2.4, 4.1, 0.2, [], { tags: ['pricey'], ...V, step: 10 }),
  F('mixed-vegetables', 'Mixed vegetables (frozen), cooked', 'خضار مشكل', 'veg', 65, 2.9, 13, 0.2, [], { ...V, step: 10, m: [M('cup', 'cups', 180)] }),
  F('sauteed-vegetables', 'Sautéed vegetables (little oil)', 'خضار سوتيه', 'veg', 55, 2, 7.5, 2.2, ['veg'], { ...V, step: 10, portion: [100, 150, 250], est: true }),
  F('grilled-vegetables', 'Grilled vegetables (zucchini, pepper, eggplant)', 'خضار مشوي', 'veg', 40, 1.3, 6.5, 1.2, ['veg'], { ...V, step: 10, portion: [100, 150, 250], est: true }),
  F('vegetable-soup', 'Vegetable soup (no cream)', 'شوربة خضار', 'veg', 35, 1.5, 6, 0.7, [], { ...V, step: 10, est: true, m: [M('bowl', 'bowls', 300)] }),
  F('tabbouleh', 'Tabbouleh', 'تبولة', 'veg', 100, 2, 10, 6, [], { tags: ['gluten'], ...V, step: 10, est: true, m: [M('cup', 'cups', 150)] }),
  F('greek-salad', 'Greek salad (with feta and olive oil)', 'سلطة يوناني', 'veg', 110, 3, 5, 8.5, [], { tags: ['dairy'], ...V, step: 10, est: true, m: [M('bowl', 'bowls', 250)] }),
  F('yogurt-cucumber-salad', 'Yogurt and cucumber salad (khiyar bel laban)', 'سلطة زبادي بالخيار', 'veg', 50, 3, 4.5, 2.2, [], { tags: ['dairy'], ...V, step: 10, est: true, m: [M('cup', 'cups', 200)] }),
  F('molokhia-plain', 'Molokhia, light (little ghee)', 'ملوخية لايت', 'veg', 40, 3, 4, 1.5, [], { ...V, step: 10, est: true, m: [M('bowl', 'bowls', 250)] }),
  F('lemon-juice', 'Lemon juice', 'عصير ليمون', 'veg', 22, 0.4, 6.9, 0.2, [], { ...V, step: 5, m: [M('tbsp', 'tbsp', 15, false)] }),
  F('garlic', 'Garlic', 'ثوم', 'veg', 149, 6.4, 33, 0.5, [], { ...V, step: 1, unit: { g: 3, name: 'clove' } }),
  F('green-pepper-hot', 'Hot green pepper', 'فلفل حامي', 'veg', 40, 2, 9.5, 0.2, [], { ...V, step: 5, unit: { g: 15, name: 'pepper' } }),
  F('cherry-tomatoes', 'Cherry tomatoes', 'طماطم شيري', 'veg', 18, 0.9, 3.9, 0.2, [], { ...V, step: 10, unit: { g: 17, name: 'tomato' } }),

  // ---------------------------------------------------------------- fruit
  F('melon', 'Melon (shahd / honeydew)', 'شمام', 'fruit', 36, 0.5, 9.1, 0.1, ['fruit'], { ...V, step: 10, portion: [150, 200, 350] }),
  F('grapefruit', 'Grapefruit', 'جريب فروت', 'fruit', 42, 0.8, 10.7, 0.1, ['fruit'], { ...V, step: 10, portion: [120, 200, 300], unit: { g: 230, name: 'grapefruit' } }),
  F('nectarine', 'Nectarine', 'نكتارين', 'fruit', 44, 1.1, 10.6, 0.3, [], { ...V, unit: { g: 140, name: 'nectarine' } }),
  F('mulberries', 'Mulberries (toot)', 'توت', 'fruit', 43, 1.4, 9.8, 0.4, [], V),
  F('raspberries', 'Raspberries', 'توت أحمر (راسبري)', 'fruit', 52, 1.2, 11.9, 0.7, [], { tags: ['pricey'], ...V }),
  F('papaya', 'Papaya', 'بابايا', 'fruit', 43, 0.5, 10.8, 0.3, [], { tags: ['pricey'], ...V }),
  F('banana-small', 'Banana, small (baladi)', 'موز بلدي صغير', 'fruit', 89, 1.1, 23, 0.3, [], { ...V, unit: { g: 90, name: 'banana' } }),
  F('green-apple', 'Green apple', 'تفاح أخضر', 'fruit', 58, 0.4, 13.6, 0.2, [], { ...V, unit: { g: 180, name: 'apple' } }),
  F('prunes', 'Prunes (dried plums)', 'برقوق مجفف', 'fruit', 240, 2.2, 64, 0.4, [], { ...V, unit: { g: 9.5, name: 'prune' } }),
  F('dates-fresh', 'Fresh dates (balah, yellow or red)', 'بلح أحمر/أصفر', 'fruit', 144, 1.5, 37, 0.2, [], { ...V, unit: { g: 15, name: 'date' }, est: true }),
  F('fruit-salad', 'Fresh fruit salad, no sugar', 'سلطة فواكه بدون سكر', 'fruit', 55, 0.7, 13.5, 0.2, [], { ...V, step: 10, est: true, m: [M('cup', 'cups', 200)] }),
  F('apple-sauce', 'Apple purée, unsweetened', 'بيوريه تفاح بدون سكر', 'fruit', 42, 0.2, 11.3, 0.1, [], { ...V, step: 10 }),

  // ---------------------------------------------------------------- fats, nuts, seeds
  F('almond-butter', 'Almond butter', 'زبدة لوز', 'fat', 614, 21, 19, 56, [], { tags: ['nuts', 'pricey'], ...V, unit: { g: 16, name: 'tbsp' } }),
  F('flaxseed', 'Flaxseed, ground', 'بذر كتان مطحون', 'fat', 534, 18.3, 28.9, 42.2, [], { ...V, unit: { g: 7, name: 'tbsp' } }),
  F('sesame-seeds', 'Sesame seeds', 'سمسم', 'fat', 573, 17.7, 23.5, 49.7, [], { tags: ['sesame'], ...V, unit: { g: 9, name: 'tbsp' } }),
  F('watermelon-seeds', 'Watermelon seeds, roasted (lib asmar)', 'لب أسمر', 'fat', 557, 28.3, 15.3, 47.4, [], V),
  F('coconut-oil', 'Coconut oil', 'زيت جوز الهند', 'fat', 892, 0, 0, 99, [], { tags: ['pricey'], ...V, unit: { g: 5, name: 'tsp' } }),
  F('light-butter', 'Butter, light (reduced fat)', 'زبدة لايت', 'fat', 499, 3.3, 0, 55.1, [], { tags: ['dairy'], ...V, unit: { g: 5, name: 'tsp' } }),
  F('hummus-light', 'Hummus, light', 'حمص بالطحينة لايت', 'legume', 120, 6, 13, 5, [], { tags: ['sesame'], ...V, step: 10, est: true, m: [M('tbsp', 'tbsp', 15, false)] }),
  F('tahini-sauce', 'Tahini sauce, diluted (lemon and water)', 'طحينة متخففة', 'fat', 260, 7.5, 9.5, 23, [], { tags: ['sesame'], ...V, est: true, m: [M('tbsp', 'tbsp', 15, false)] }),

  // ---------------------------------------------------------------- diet sweets & drinks
  F('jelly-sugar-free', 'Jelly, sugar-free', 'جيلي دايت', 'sweet', 13, 1.1, 1.6, 0, [], { ...V, unit: { g: 120, name: 'cup' } }),
  F('dark-chocolate-85', 'Dark chocolate, 85%', 'شوكولاتة داكنة ٨٥٪', 'sweet', 600, 10, 20, 50, [], { tags: ['pricey'], ...V, unit: { g: 10, name: 'square' }, est: true }),
  F('date-syrup', 'Date syrup (dibs)', 'عسل بلح', 'sweet', 290, 1.5, 72, 0.2, [], { ...V, unit: { g: 20, name: 'tbsp' }, est: true }),
];

/** Household measures for these foods, in measures.js format: { id: [{ name, plural, g, half }] }. */
export const MORE_DIET_MEASURES = Object.fromEntries(MORE_DIET_FOODS.filter((f) => f.measures.length)
  .map((f) => [f.id, f.measures.map(([name, plural, g, half]) => ({ name, plural, g, half }))]));
