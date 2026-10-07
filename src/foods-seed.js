// Seed food database (v2): what people in Egypt actually eat, at home, on the street and on a diet.
//
// Values are per 100 g of the food AS EATEN (cooked weight for cooked foods).
// Sources: USDA FoodData Central for single ingredients; Egyptian composite dishes (koshari,
// molokhia, mahshi, hawawshi, fattah, feteer...) are estimates from common recipes and are
// marked `est: true`, because home recipes vary a lot. The admin can edit any value in the app.
//
// Fields
//   id, name (English), ar (Arabic, used for search and by the AI coach), cat (display group)
//   kcal, p, c, f        per 100 g
//   roles                meal slots the plan generator may use the food in
//   tags                 food groups people can exclude ("I never eat ...")
//   veg                  vegetarian (eggs and dairy allowed)
//   portion [min, typ, max] grams for one serving in a plan; step = rounding step
//   unit { g, name }     a countable unit (1 egg = 50 g, 1 slice = 30 g ...)
//   raw                  cooked weight / dry weight, for foods usually weighed dry (rice, pasta, lentils)

const F = (id, name, ar, cat, kcal, p, c, f, roles, o = {}) => ({
  id, name, ar, cat, kcal, p, c, f, roles,
  tags: o.tags ?? [], veg: o.veg ?? false, step: o.step ?? 5,
  max: o.portion ? o.portion[2] : (o.max ?? 500), portion: o.portion ?? null, unit: o.unit ?? null, est: o.est ?? false, raw: o.raw ?? null,
});
import { MORE_DIET_FOODS } from './foods-more.js';

const V = { veg: true };

// The original list; MORE_DIET_FOODS (foods-more.js) adds the session-13 staples after it.
const BASE_FOODS = [
  // ---------------------------------------------------------------- poultry & meat
  F('chicken-breast', 'Chicken breast, grilled', 'صدور فراخ مشوية', 'protein', 165, 31, 0, 3.6, ['mainProtein'], { tags: ['poultry'], step: 10, portion: [120, 170, 250] }),
  F('chicken-thigh', 'Chicken thigh, grilled, skinless', 'أوراك فراخ مشوية', 'protein', 179, 24.8, 0, 8.2, ['mainProtein'], { tags: ['poultry'], step: 10, portion: [120, 160, 230] }),
  F('shish-tawook', 'Shish tawook', 'شيش طاووق', 'protein', 160, 25, 2, 5.5, ['mainProtein'], { tags: ['poultry', 'dairy'], step: 10, portion: [120, 170, 250], est: true }),
  F('turkey-breast', 'Turkey breast, cooked', 'صدور رومي', 'protein', 135, 30, 0, 1, ['mainProtein'], { tags: ['pricey', 'poultry'], step: 10, portion: [120, 160, 230] }),
  F('smoked-turkey', 'Smoked turkey slices', 'تيركي مدخن', 'protein', 104, 17, 4.2, 1.7, ['bfProtein', 'snack'], { tags: ['pricey', 'poultry'], step: 10, portion: [40, 80, 120] }),
  F('beef-lean', 'Beef, lean, cooked', 'لحمة بقري قليلة الدهن', 'protein', 217, 26, 0, 12, ['mainProtein'], { tags: ['meat'], step: 10, portion: [120, 150, 220] }),
  F('beef-steak', 'Beef steak, grilled', 'ستيك بقري مشوي', 'protein', 190, 29, 0, 7.5, ['mainProtein'], { tags: ['pricey', 'meat'], step: 10, portion: [120, 170, 250] }),
  F('kofta', 'Kofta, grilled', 'كفتة مشوية', 'protein', 250, 18, 4, 18, ['mainProtein'], { tags: ['meat'], step: 10, portion: [100, 150, 200], est: true }),
  F('minced-beef', 'Minced beef, cooked', 'لحمة مفرومة', 'protein', 250, 26, 0, 15, ['mainProtein'], { tags: ['meat'], step: 10, portion: [100, 140, 200] }),
  F('beef-liver', 'Beef liver, pan-fried', 'كبدة', 'protein', 175, 26.5, 5.2, 4.7, ['mainProtein'], { tags: ['meat', 'organ'], step: 10, portion: [100, 150, 200] }),
  F('lamb', 'Lamb, lean, roasted', 'لحم ضاني', 'protein', 206, 28, 0, 9.5, ['mainProtein'], { tags: ['pricey', 'meat'], step: 10, portion: [120, 150, 220] }),

  // ---------------------------------------------------------------- fish & seafood
  F('tilapia', 'Tilapia (bolti), grilled', 'بلطي مشوي', 'protein', 128, 26, 0, 2.7, ['mainProtein'], { tags: ['fish'], step: 10, portion: [150, 200, 300] }),
  F('sea-bream', 'Sea bream (denis), grilled', 'دنيس مشوي', 'protein', 135, 24, 0, 4, ['mainProtein'], { tags: ['pricey', 'fish'], step: 10, portion: [150, 200, 300] }),
  F('salmon', 'Salmon, cooked', 'سالمون', 'protein', 206, 22, 0, 12, ['mainProtein'], { tags: ['pricey', 'fish'], step: 10, portion: [120, 150, 200] }),
  F('mackerel', 'Mackerel, cooked', 'ماكريل', 'protein', 262, 24, 0, 18, ['mainProtein'], { tags: ['fish'], step: 10, portion: [100, 140, 200] }),
  F('tuna-canned', 'Tuna in water, drained', 'تونة مياه', 'protein', 116, 26, 0, 1, ['mainProtein', 'bfProtein'], { tags: ['fish'], step: 10, portion: [80, 120, 170] }),
  F('tuna-oil', 'Tuna in oil, drained', 'تونة زيت', 'protein', 198, 29, 0, 8, ['mainProtein', 'bfProtein'], { tags: ['fish'], step: 10, portion: [80, 120, 170] }),
  F('sardines', 'Sardines in oil, drained', 'سردين معلب', 'protein', 208, 25, 0, 11.5, ['mainProtein', 'bfProtein'], { tags: ['fish'], step: 10, portion: [80, 100, 150] }),
  F('shrimp', 'Shrimp, grilled', 'جمبري مشوي', 'protein', 99, 24, 0.2, 0.3, ['mainProtein'], { tags: ['pricey', 'seafood'], step: 10, portion: [120, 180, 250] }),
  F('calamari', 'Calamari, grilled', 'كاليماري مشوي', 'protein', 110, 18, 4, 2, ['mainProtein'], { tags: ['pricey', 'seafood'], step: 10, portion: [120, 170, 250], est: true }),

  // ---------------------------------------------------------------- eggs & dairy
  F('eggs', 'Eggs, boiled', 'بيض مسلوق', 'protein', 155, 12.6, 1.1, 10.6, ['bfProtein'], { tags: ['egg'], ...V, step: 50, portion: [100, 150, 200], unit: { g: 50, name: 'egg' } }),
  F('egg-whites', 'Egg whites', 'بياض بيض', 'protein', 52, 10.9, 0.7, 0.2, ['bfProtein', 'boost'], { tags: ['egg'], ...V, step: 30, portion: [60, 120, 180], unit: { g: 30, name: 'white' } }),
  F('omelette', 'Omelette (eggs, little oil)', 'أومليت', 'protein', 165, 11, 1.5, 12.5, ['bfProtein'], { tags: ['egg'], ...V, step: 10, portion: [100, 150, 220], est: true }),
  F('areesh', 'Areesh cheese', 'جبنة قريش', 'dairy', 90, 13, 3.5, 2.5, ['bfProtein', 'snack'], { tags: ['dairy'], ...V, step: 10, portion: [80, 120, 200], est: true }),
  F('cottage-cheese', 'Cottage cheese', 'جبنة قريش معلبة', 'dairy', 98, 11, 3.4, 4.3, ['bfProtein', 'snack'], { tags: ['dairy'], ...V, step: 10, portion: [80, 120, 200] }),
  F('white-cheese', 'White cheese (Domiati)', 'جبنة بيضاء', 'dairy', 264, 14, 4, 21, ['bfProtein'], { tags: ['dairy'], ...V, step: 10, portion: [30, 50, 70] }),
  F('white-cheese-light', 'White cheese, light', 'جبنة بيضاء لايت', 'dairy', 150, 14, 4, 9, ['bfProtein'], { tags: ['dairy'], ...V, step: 10, portion: [40, 60, 100], est: true }),
  F('mozzarella', 'Mozzarella, part-skim', 'موتزاريلا', 'dairy', 254, 24, 2.8, 16, ['bfProtein'], { tags: ['pricey', 'dairy'], ...V, step: 10, portion: [30, 40, 60] }),
  F('roumy', 'Roumy cheese', 'جبنة رومي', 'dairy', 380, 27, 1, 30, ['bfProtein'], { tags: ['dairy'], ...V, step: 10, portion: [20, 30, 40], est: true }),
  F('labneh', 'Labneh', 'لبنة', 'dairy', 160, 6.5, 4.5, 13, ['bfProtein'], { tags: ['dairy'], ...V, step: 10, portion: [30, 50, 80] }),
  F('greek-yogurt', 'Greek yogurt, 0%', 'زبادي يوناني لايت', 'dairy', 59, 10.2, 3.6, 0.4, ['bfProtein', 'snack'], { tags: ['dairy'], ...V, step: 10, portion: [150, 170, 340] }),
  F('greek-yogurt-2', 'Greek yogurt, 2%', 'زبادي يوناني', 'dairy', 73, 9.9, 3.9, 1.9, ['bfProtein', 'snack'], { tags: ['pricey', 'dairy'], ...V, step: 10, portion: [150, 170, 340] }),
  F('plain-yogurt', 'Plain yogurt (zabadi)', 'زبادي', 'dairy', 61, 3.5, 4.7, 3.3, ['bfProtein', 'snack'], { tags: ['dairy'], ...V, step: 10, portion: [105, 210, 315], unit: { g: 105, name: 'cup' } }),
  F('protein-yogurt-drink', 'High-protein yogurt drink', 'زبادي بروتين للشرب', 'dairy', 65, 6.5, 8, 0.5, ['snack', 'boost'], { tags: ['pricey', 'dairy'], ...V, step: 10, portion: [260, 260, 520], unit: { g: 260, name: 'bottle' }, est: true }),
  F('milk', 'Milk, full-fat', 'لبن كامل الدسم', 'dairy', 62, 3.3, 4.8, 3.3, ['snack', 'bfCarb'], { tags: ['dairy'], ...V, step: 10, portion: [150, 250, 300] }),
  F('milk-skim', 'Milk, skimmed', 'لبن خالي الدسم', 'dairy', 34, 3.4, 5, 0.1, ['snack', 'bfCarb'], { tags: ['dairy'], ...V, step: 10, portion: [150, 250, 400] }),
  F('whey', 'Whey protein', 'واي بروتين', 'protein', 400, 80, 8, 6, ['snack', 'boost'], { tags: ['dairy'], ...V, step: 5, portion: [0, 30, 40], unit: { g: 30, name: 'scoop' } }),
  F('protein-bar', 'Protein bar', 'بروتين بار', 'snack', 360, 30, 38, 12, ['snack'], { tags: ['pricey', 'dairy', 'nuts'], ...V, step: 5, portion: [45, 60, 60], unit: { g: 60, name: 'bar' }, est: true }),

  // ---------------------------------------------------------------- legumes & vegetarian mains
  F('ful-medames', 'Ful medames', 'فول مدمس', 'legume', 110, 7.6, 19.6, 0.4, ['bfProtein', 'vegMain'], { ...V, portion: [150, 200, 300] }),
  F('taameya', 'Taameya (falafel), fried', 'طعمية', 'legume', 333, 13.3, 31.8, 17.8, ['bfProtein', 'vegMain'], { tags: ['sesame'], ...V, portion: [50, 90, 150], unit: { g: 30, name: 'piece' } }),
  F('lentils', 'Lentils, cooked', 'عدس', 'legume', 116, 9, 20, 0.4, ['vegMain', 'carb'], { ...V, raw: 3.0, portion: [150, 250, 350] }),
  F('lentil-soup', 'Lentil soup', 'شوربة عدس', 'legume', 75, 4.5, 11, 1.5, ['vegMain'], { ...V, portion: [300, 300, 450], unit: { g: 300, name: 'bowl' }, est: true }),
  F('chickpeas', 'Chickpeas, cooked', 'حمص', 'legume', 164, 8.9, 27, 2.6, ['vegMain', 'carb'], { ...V, raw: 2.2, portion: [100, 150, 250] }),
  F('hummus', 'Hummus', 'حمص بالطحينة', 'legume', 166, 7.9, 14.3, 9.6, ['bfProtein', 'fat'], { tags: ['sesame'], ...V, portion: [40, 60, 100] }),
  F('lupini', 'Lupini beans (termes)', 'ترمس', 'legume', 119, 15.6, 9.9, 2.9, ['snack'], { ...V, portion: [80, 120, 200] }),
  F('tofu', 'Tofu, firm', 'توفو', 'legume', 76, 8, 1.9, 4.8, ['vegMain'], { tags: ['soy'], ...V, portion: [120, 180, 250] }),

  // ---------------------------------------------------------------- breads & breakfast carbs
  F('baladi-bread', 'Baladi bread', 'عيش بلدي', 'carb', 266, 9, 55, 1.2, ['bfCarb', 'carb'], { tags: ['gluten'], ...V, step: 45, portion: [45, 90, 135], unit: { g: 90, name: 'loaf' } }),
  F('shami-bread', 'Shami bread (white pita)', 'عيش شامي', 'carb', 275, 9.1, 55.7, 1.2, ['bfCarb', 'carb'], { tags: ['gluten'], ...V, step: 30, portion: [30, 60, 120], unit: { g: 60, name: 'loaf' } }),
  F('toast-brown', 'Brown toast', 'توست أسمر', 'carb', 252, 12.4, 42.7, 3.5, ['bfCarb', 'carb'], { tags: ['gluten'], ...V, step: 30, portion: [60, 60, 120], unit: { g: 30, name: 'slice' } }),
  F('toast-white', 'White toast', 'توست أبيض', 'carb', 266, 7.6, 50.6, 3.3, ['bfCarb', 'carb'], { tags: ['gluten'], ...V, step: 30, portion: [60, 60, 120], unit: { g: 30, name: 'slice' } }),
  F('tortilla', 'Tortilla wrap', 'تورتيلا', 'carb', 304, 8.3, 51, 7.5, ['bfCarb', 'carb'], { tags: ['gluten'], ...V, step: 45, portion: [45, 45, 90], unit: { g: 45, name: 'tortilla' } }),
  F('tortilla-ww', 'Whole-wheat tortilla', 'تورتيلا بر', 'carb', 290, 9, 47, 7, ['bfCarb', 'carb'], { tags: ['gluten'], ...V, step: 45, portion: [45, 45, 90], unit: { g: 45, name: 'tortilla' }, est: true }),
  F('fino', 'Fino bread', 'عيش فينو', 'carb', 280, 9, 54, 2.5, ['bfCarb', 'carb'], { tags: ['gluten'], ...V, step: 60, portion: [60, 60, 120], unit: { g: 60, name: 'roll' }, est: true }),
  F('oats', 'Oats, dry', 'شوفان', 'carb', 389, 16.9, 66, 6.9, ['bfCarb'], { tags: ['gluten'], ...V, portion: [40, 60, 100] }),
  F('corn-flakes', 'Corn flakes', 'كورن فليكس', 'carb', 357, 7.5, 84, 0.4, ['bfCarb'], { ...V, portion: [30, 40, 60] }),
  F('granola', 'Granola', 'جرانولا', 'carb', 471, 10, 64, 20, ['bfCarb', 'snack'], { tags: ['pricey', 'gluten', 'nuts'], ...V, portion: [30, 40, 60] }),
  F('rice-cakes', 'Rice cakes', 'رايس كيك', 'carb', 387, 8, 81, 2.8, ['snack', 'bfCarb'], { ...V, step: 9, portion: [18, 27, 36], unit: { g: 9, name: 'cake' } }),
  F('feteer', 'Feteer meshaltet', 'فطير مشلتت', 'carb', 420, 7, 40, 26, ['bfCarb'], { tags: ['gluten', 'dairy'], ...V, portion: [60, 100, 150], est: true }),

  // ---------------------------------------------------------------- rice, pasta, potatoes, grains
  F('white-rice', 'White rice, cooked', 'رز أبيض', 'carb', 130, 2.7, 28, 0.3, ['carb'], { ...V, step: 10, raw: 2.8, portion: [100, 180, 300] }),
  F('basmati', 'Basmati rice, cooked', 'رز بسمتي', 'carb', 121, 3.5, 25, 0.4, ['carb'], { ...V, step: 10, raw: 3.0, portion: [100, 180, 300] }),
  F('brown-rice', 'Brown rice, cooked', 'رز بني', 'carb', 123, 2.7, 25.6, 1, ['carb'], { ...V, step: 10, raw: 2.9, portion: [100, 180, 300] }),
  F('vermicelli-rice', 'Rice with vermicelli', 'رز بالشعرية', 'carb', 150, 3, 28, 3, ['carb'], { tags: ['gluten'], ...V, step: 10, raw: 2.5, portion: [100, 180, 280], est: true }),
  F('pasta', 'Pasta, cooked', 'مكرونة', 'carb', 158, 5.8, 31, 0.9, ['carb'], { tags: ['gluten'], ...V, step: 10, raw: 2.3, portion: [100, 180, 300] }),
  F('pasta-ww', 'Whole-wheat pasta, cooked', 'مكرونة بر', 'carb', 149, 6, 30, 1.7, ['carb'], { tags: ['gluten'], ...V, step: 10, raw: 2.3, portion: [100, 180, 300] }),
  F('bulgur', 'Bulgur, cooked', 'برغل', 'carb', 83, 3, 19, 0.2, ['carb'], { tags: ['gluten'], ...V, step: 10, raw: 3.5, portion: [120, 200, 320] }),
  F('freekeh', 'Freekeh, cooked', 'فريك', 'carb', 120, 4.5, 24, 1, ['carb'], { tags: ['gluten'], ...V, step: 10, raw: 2.7, portion: [120, 180, 280], est: true }),
  F('quinoa', 'Quinoa, cooked', 'كينوا', 'carb', 120, 4.4, 21, 1.9, ['carb'], { tags: ['pricey'], ...V, step: 10, raw: 3.0, portion: [100, 180, 280] }),
  F('potato', 'Potato, boiled', 'بطاطس مسلوقة', 'carb', 87, 1.9, 20, 0.1, ['carb'], { ...V, step: 10, portion: [150, 220, 350] }),
  F('potato-baked', 'Potato, oven-baked wedges', 'بطاطس في الفرن', 'carb', 130, 2.5, 22, 3.5, ['carb'], { ...V, step: 10, portion: [120, 200, 300], est: true }),
  F('sweet-potato', 'Sweet potato, baked', 'بطاطا', 'carb', 90, 2, 21, 0.2, ['carb'], { ...V, step: 10, portion: [150, 220, 350] }),

  // ---------------------------------------------------------------- Egyptian dishes (complete plates)
  F('koshari', 'Koshari', 'كشري', 'dish', 150, 4.5, 25, 3.5, ['dish'], { tags: ['gluten'], ...V, step: 50, portion: [200, 300, 400], est: true }), // rice, lentils, pasta, fried onions and oil: about 450 kcal a 300 g box
  F('molokhia', 'Molokhia', 'ملوخية', 'dish', 60, 3, 4, 3.5, ['side'], { ...V, portion: [250, 250, 375], unit: { g: 250, name: 'bowl' }, est: true }),
  F('mahshi', 'Mahshi (stuffed vegetables)', 'محشي', 'dish', 150, 3, 22, 5.5, ['carb'], { ...V, step: 50, portion: [150, 250, 350], est: true }),
  F('fattah', 'Fattah with meat', 'فتة باللحمة', 'dish', 210, 9, 22, 9, ['dish'], { tags: ['meat', 'gluten'], step: 50, portion: [250, 350, 450], est: true }),
  F('macarona-bechamel', 'Macarona bechamel', 'مكرونة بشاميل', 'dish', 180, 8, 16, 9, ['dish'], { tags: ['meat', 'gluten', 'dairy'], step: 50, portion: [200, 250, 350], est: true }),
  F('hawawshi', 'Hawawshi', 'حواوشي', 'dish', 260, 12, 22, 14, ['dish'], { tags: ['meat', 'gluten'], step: 50, portion: [150, 200, 250], unit: { g: 200, name: 'hawawshi' }, est: true }),
  F('chicken-shawarma', 'Chicken shawarma sandwich', 'ساندوتش شاورما فراخ', 'dish', 210, 13, 21, 8, ['dish'], { tags: ['poultry', 'gluten', 'sesame'], step: 50, portion: [200, 250, 300], unit: { g: 250, name: 'sandwich' }, est: true }),
  F('liver-sandwich', 'Alexandrian liver sandwich', 'ساندوتش كبدة', 'dish', 230, 13, 22, 10, ['dish'], { tags: ['meat', 'organ', 'gluten'], step: 50, portion: [150, 200, 250], unit: { g: 150, name: 'sandwich' }, est: true }),
  F('okra-stew', 'Okra stew with meat', 'بامية باللحمة', 'dish', 110, 7, 7, 6, ['side'], { tags: ['meat'], step: 50, portion: [200, 250, 350], est: true }),
  F('green-beans-stew', 'Green beans stew', 'فاصوليا خضرا', 'dish', 80, 4, 7, 4, ['side'], { ...V, portion: [250, 250, 375], unit: { g: 250, name: 'bowl' }, est: true }),
  F('peas-stew', 'Peas and carrots stew', 'بسلة بالجزر', 'dish', 100, 5, 10, 4.5, ['side'], { ...V, portion: [250, 250, 375], unit: { g: 250, name: 'bowl' }, est: true }),

  // ---------------------------------------------------------------- vegetables & salads
  F('salata-baladi', 'Egyptian salad (salata baladi)', 'سلطة بلدي', 'veg', 20, 0.9, 4.2, 0.2, ['veg'], { ...V, step: 10, portion: [100, 150, 250] }),
  F('cucumber', 'Cucumber', 'خيار', 'veg', 15, 0.7, 3.6, 0.1, ['veg'], { ...V, step: 10, portion: [100, 150, 250] }),
  F('tomato', 'Tomato', 'طماطم', 'veg', 18, 0.9, 3.9, 0.2, ['veg'], { ...V, step: 10, portion: [100, 150, 250] }),
  F('salad-greens', 'Green salad (lettuce, rocca)', 'سلطة خضرا', 'veg', 15, 1.4, 2.9, 0.2, ['veg'], { ...V, step: 10, portion: [80, 120, 200] }),
  F('bell-pepper', 'Bell pepper', 'فلفل رومي', 'veg', 26, 1, 6, 0.3, ['veg'], { ...V, step: 10, portion: [80, 120, 200] }),
  F('broccoli', 'Broccoli, steamed', 'بروكلي', 'veg', 35, 2.4, 7.2, 0.4, ['veg'], { ...V, step: 10, portion: [100, 150, 250] }),
  F('zucchini', 'Zucchini (koosa), cooked', 'كوسة', 'veg', 17, 1.2, 3.1, 0.3, ['veg'], { ...V, step: 10, portion: [100, 150, 250] }),
  F('carrot', 'Carrot', 'جزر', 'veg', 41, 0.9, 10, 0.2, ['veg'], { ...V, step: 10, portion: [80, 120, 200] }),
  F('green-beans', 'Green beans, steamed', 'فاصوليا خضرا سوتيه', 'veg', 35, 1.9, 7.9, 0.3, ['veg'], { ...V, step: 10, portion: [100, 150, 250] }),
  F('eggplant', 'Eggplant, grilled', 'باذنجان مشوي', 'veg', 35, 0.8, 8.7, 0.2, ['veg'], { ...V, step: 10, portion: [100, 150, 250] }),
  F('spinach', 'Spinach, cooked', 'سبانخ', 'veg', 23, 3, 3.8, 0.3, ['veg'], { ...V, step: 10, portion: [100, 150, 250] }),
  F('cauliflower', 'Cauliflower, steamed', 'قرنبيط', 'veg', 25, 1.9, 5, 0.3, ['veg'], { ...V, step: 10, portion: [100, 150, 250] }),
  F('mushrooms', 'Mushrooms, sautéed', 'مشروم', 'veg', 22, 3.1, 3.3, 0.3, ['veg'], { ...V, step: 10, portion: [80, 120, 200] }),
  F('baba-ghanoush', 'Baba ghanoush', 'بابا غنوج', 'veg', 132, 2.5, 7.5, 11, ['fat'], { tags: ['sesame'], ...V, portion: [40, 60, 100], est: true }),
  F('tahini-salad', 'Tahini salad', 'سلطة طحينة', 'veg', 200, 6, 8, 16, ['fat'], { tags: ['sesame'], ...V, portion: [30, 50, 80], est: true }),
  F('pickles', 'Pickles (mekhalel)', 'مخلل', 'veg', 11, 0.3, 2.3, 0.2, ['veg'], { ...V, step: 10, portion: [20, 40, 80] }),

  // ---------------------------------------------------------------- fruit
  F('banana', 'Banana', 'موز', 'fruit', 89, 1.1, 23, 0.3, ['fruit'], { ...V, step: 10, portion: [120, 120, 240], unit: { g: 120, name: 'banana' } }),
  F('apple', 'Apple', 'تفاح', 'fruit', 52, 0.3, 14, 0.2, ['fruit'], { ...V, step: 10, portion: [100, 180, 250], unit: { g: 180, name: 'apple' } }),
  F('orange', 'Orange', 'برتقال', 'fruit', 47, 0.9, 12, 0.1, ['fruit'], { ...V, step: 10, portion: [100, 150, 250], unit: { g: 150, name: 'orange' } }),
  F('mango', 'Mango', 'مانجو', 'fruit', 60, 0.8, 15, 0.4, ['fruit'], { ...V, step: 10, portion: [100, 150, 250] }),
  F('guava', 'Guava', 'جوافة', 'fruit', 68, 2.6, 14, 1, ['fruit'], { ...V, step: 10, portion: [100, 150, 250] }),
  F('watermelon', 'Watermelon', 'بطيخ', 'fruit', 30, 0.6, 7.6, 0.2, ['fruit'], { ...V, step: 10, portion: [150, 250, 400] }),
  F('cantaloupe', 'Cantaloupe', 'كانتالوب', 'fruit', 34, 0.8, 8, 0.2, ['fruit'], { ...V, step: 10, portion: [150, 200, 350] }),
  F('strawberries', 'Strawberries', 'فراولة', 'fruit', 32, 0.7, 7.7, 0.3, ['fruit'], { tags: ['pricey'], ...V, step: 10, portion: [100, 150, 250] }),
  F('grapes', 'Grapes', 'عنب', 'fruit', 69, 0.7, 18, 0.2, ['fruit'], { ...V, step: 10, portion: [80, 120, 200] }),
  F('figs', 'Figs, fresh', 'تين', 'fruit', 74, 0.8, 19, 0.3, ['fruit'], { ...V, step: 10, portion: [80, 120, 200] }),
  F('pomegranate', 'Pomegranate', 'رمان', 'fruit', 83, 1.7, 19, 1.2, ['fruit'], { ...V, step: 10, portion: [80, 120, 200] }),
  F('peach', 'Peach', 'خوخ', 'fruit', 39, 0.9, 10, 0.3, ['fruit'], { ...V, step: 10, portion: [100, 150, 250] }),
  F('kiwi', 'Kiwi', 'كيوي', 'fruit', 61, 1.1, 15, 0.5, ['fruit'], { tags: ['pricey'], ...V, step: 10, portion: [70, 140, 210], unit: { g: 70, name: 'kiwi' } }),
  F('dates', 'Dates', 'بلح / تمر', 'fruit', 282, 2.5, 75, 0.4, ['fruit'], { ...V, step: 10, portion: [20, 40, 60], unit: { g: 10, name: 'date' } }),
  F('raisins', 'Raisins', 'زبيب', 'fruit', 299, 3.1, 79, 0.5, ['fruit'], { ...V, step: 5, portion: [15, 25, 40] }),
  F('dried-apricot', 'Dried apricots (mishmishiya)', 'مشمشية', 'fruit', 241, 3.4, 63, 0.5, ['fruit'], { ...V, step: 5, portion: [20, 30, 50] }),
  F('orange-juice', 'Orange juice, fresh', 'عصير برتقال فريش', 'fruit', 45, 0.7, 10, 0.2, ['fruit'], { ...V, step: 50, portion: [200, 250, 300] }),

  // ---------------------------------------------------------------- fats, nuts, spreads
  F('olive-oil', 'Olive oil', 'زيت زيتون', 'fat', 884, 0, 0, 100, ['fat'], { ...V, step: 1, portion: [5, 10, 15], unit: { g: 5, name: 'tsp' } }),
  F('ghee', 'Ghee (samna)', 'سمنة', 'fat', 900, 0, 0, 100, ['fat'], { tags: ['dairy'], ...V, step: 1, portion: [5, 10, 15] }),
  F('butter', 'Butter', 'زبدة', 'fat', 717, 0.9, 0.1, 81, ['fat'], { tags: ['dairy'], ...V, step: 1, portion: [5, 10, 15] }),
  F('tahini', 'Tahini', 'طحينة', 'fat', 595, 17, 21, 54, ['fat'], { tags: ['sesame'], ...V, portion: [10, 15, 30], unit: { g: 15, name: 'tbsp' } }),
  F('peanut-butter', 'Peanut butter', 'زبدة فول سوداني', 'fat', 588, 25, 20, 50, ['fat'], { tags: ['peanut'], ...V, portion: [10, 16, 32], unit: { g: 16, name: 'tbsp' } }),
  F('almonds', 'Almonds', 'لوز', 'fat', 579, 21, 22, 50, ['fat', 'snack'], { tags: ['pricey', 'nuts'], ...V, portion: [10, 20, 30] }),
  F('walnuts', 'Walnuts', 'عين جمل', 'fat', 654, 15, 14, 65, ['fat', 'snack'], { tags: ['pricey', 'nuts'], ...V, portion: [10, 20, 30] }),
  F('cashews', 'Cashews', 'كاجو', 'fat', 553, 18, 30, 44, ['fat', 'snack'], { tags: ['pricey', 'nuts'], ...V, portion: [10, 20, 30] }),
  F('peanuts', 'Peanuts', 'سوداني', 'fat', 567, 26, 16, 49, ['fat', 'snack'], { tags: ['peanut'], ...V, portion: [15, 25, 40] }),
  F('sunflower-seeds', 'Sunflower seeds (lib sory)', 'لب سوري', 'fat', 584, 21, 20, 51, ['snack'], { ...V, portion: [15, 25, 40] }),
  F('avocado', 'Avocado', 'أفوكادو', 'fat', 160, 2, 8.5, 14.7, ['fat'], { tags: ['pricey'], ...V, step: 10, portion: [40, 70, 100] }),

  // ---------------------------------------------------------------- everyday foods for logging and swaps
  // No meal roles: the plan generator never puts these in a plan, but they are real diet foods,
  // so they can be logged, chosen as a swap and, eaten instead of a planned item, count as plan
  // food (fried instead of boiled eggs, cheddar instead of white cheese, a pear instead of an apple).
  F('eggs-fried', 'Eggs, fried', 'بيض مقلي', 'protein', 196, 13.6, 0.8, 15, [], { tags: ['egg'], ...V, unit: { g: 46, name: 'egg' } }),
  F('eggs-scrambled', 'Eggs, scrambled', 'بيض مخفوق (أومليت مقلب)', 'protein', 149, 10, 1.6, 11, [], { tags: ['egg', 'dairy'], ...V, unit: { g: 60, name: 'egg' } }),
  F('chicken-roast', 'Roast chicken, with skin', 'فراخ مشوية بالجلد', 'protein', 239, 27, 0, 14, [], { tags: ['poultry'], step: 10 }),
  F('chicken-liver', 'Chicken liver, cooked', 'كبدة فراخ', 'protein', 167, 24, 0.9, 6.5, [], { tags: ['poultry', 'organ'], step: 10 }),
  F('kebab', 'Kebab (grilled meat cubes)', 'كباب', 'protein', 230, 26, 1, 14, [], { tags: ['meat'], step: 10, est: true }),
  F('basa', 'Basa fish fillet, grilled', 'سمك باسا مشوي', 'protein', 110, 20, 0, 3.3, [], { tags: ['fish'], step: 10 }),
  F('bouri', 'Mullet (bouri), grilled', 'بوري مشوي', 'protein', 150, 24.8, 0, 4.9, [], { tags: ['fish'], step: 10 }),
  F('cheddar', 'Cheddar cheese', 'جبنة شيدر', 'dairy', 403, 23, 3.1, 33, [], { tags: ['dairy'], ...V, unit: { g: 20, name: 'slice' } }),
  F('feta', 'Feta cheese', 'جبنة فيتا', 'dairy', 264, 14, 4, 21, [], { tags: ['dairy'], ...V }),
  F('halloumi', 'Halloumi, grilled', 'جبنة حلومي', 'dairy', 321, 22, 2.2, 25, [], { tags: ['dairy'], ...V, unit: { g: 25, name: 'slice' } }),
  F('gouda', 'Gouda cheese', 'جبنة جودا', 'dairy', 356, 25, 2.2, 27, [], { tags: ['dairy'], ...V, unit: { g: 20, name: 'slice' } }),
  F('cheese-triangle', 'Spreadable cheese triangle', 'جبنة مثلثات', 'dairy', 240, 10, 6, 19, [], { tags: ['dairy'], ...V, unit: { g: 17.5, name: 'triangle' } }),
  F('cheese-square', 'Cream cheese square (Kiri type)', 'جبنة مربعات كيري', 'dairy', 320, 8, 3, 30, [], { tags: ['dairy'], ...V, unit: { g: 18, name: 'square' } }),
  F('parmesan', 'Parmesan, grated', 'جبنة بارميزان', 'dairy', 431, 38, 4, 29, [], { tags: ['dairy'], ...V }),
  F('rayeb', 'Rayeb (fermented milk)', 'لبن رايب', 'dairy', 60, 3.3, 4.5, 3.3, [], { tags: ['dairy'], ...V, step: 50 }),
  F('white-beans', 'White beans (fasolia), cooked', 'فاصوليا بيضاء', 'legume', 139, 9.7, 25, 0.4, [], V),
  F('black-eyed-peas', 'Black-eyed peas (lobia), cooked', 'لوبيا', 'legume', 116, 7.7, 21, 0.5, [], V),
  F('couscous', 'Couscous, cooked', 'كسكسي', 'carb', 112, 3.8, 23, 0.2, [], { tags: ['gluten'], ...V, raw: 2.5 }),
  F('corn', 'Sweet corn', 'ذرة', 'carb', 96, 3.4, 21, 1.5, [], V),
  F('peas', 'Green peas, cooked', 'بسلة', 'veg', 84, 5.4, 15.6, 0.2, [], V),
  F('beetroot', 'Beetroot, cooked', 'بنجر', 'veg', 44, 1.7, 10, 0.2, [], V),
  F('onion', 'Onion', 'بصل', 'veg', 40, 1.1, 9.3, 0.1, [], { ...V, unit: { g: 110, name: 'onion' } }),
  F('okra', 'Okra (bamya), cooked', 'بامية', 'veg', 22, 1.9, 4.5, 0.2, [], V),
  F('cabbage', 'Cabbage', 'كرنب', 'veg', 25, 1.3, 6, 0.1, [], V),
  F('radish', 'Radish', 'فجل', 'veg', 16, 0.7, 3.4, 0.1, [], V),
  F('artichoke', 'Artichoke hearts, cooked', 'خرشوف', 'veg', 47, 3.3, 10.5, 0.2, [], V),
  F('pumpkin', 'Pumpkin, cooked', 'قرع عسلي', 'veg', 26, 1, 6.5, 0.1, [], V),
  F('pear', 'Pear', 'كمثرى', 'fruit', 57, 0.4, 15, 0.1, [], { ...V, unit: { g: 180, name: 'pear' } }),
  F('plum', 'Plum', 'برقوق', 'fruit', 46, 0.7, 11.4, 0.3, [], { ...V, unit: { g: 65, name: 'plum' } }),
  F('apricot', 'Apricot, fresh', 'مشمش', 'fruit', 48, 1.4, 11, 0.4, [], { ...V, unit: { g: 35, name: 'apricot' } }),
  F('cherries', 'Cherries', 'كريز', 'fruit', 63, 1.1, 16, 0.2, [], V),
  F('pineapple', 'Pineapple', 'أناناس', 'fruit', 50, 0.5, 13, 0.1, [], V),
  F('kaki', 'Persimmon (kaki)', 'كاكا', 'fruit', 70, 0.6, 18.6, 0.2, [], { ...V, unit: { g: 170, name: 'kaki' } }),
  F('prickly-pear', 'Prickly pear (teen shoky)', 'تين شوكي', 'fruit', 41, 0.7, 9.6, 0.5, [], { ...V, unit: { g: 100, name: 'piece' } }),
  F('blueberries', 'Blueberries', 'توت أزرق', 'fruit', 57, 0.7, 14.5, 0.3, [], { tags: ['pricey'], ...V }),
  F('mandarin', 'Mandarin (yousef effendi)', 'يوسفي', 'fruit', 53, 0.8, 13.3, 0.3, [], { ...V, unit: { g: 90, name: 'mandarin' } }),
  F('dried-figs', 'Dried figs', 'تين مجفف', 'fruit', 249, 3.3, 64, 0.9, [], { ...V, unit: { g: 20, name: 'fig' } }),
  F('olives-green', 'Olives, green', 'زيتون أخضر', 'fat', 145, 1, 3.8, 15, [], { ...V, unit: { g: 4, name: 'olive' } }),
  F('olives-black', 'Olives, black', 'زيتون أسود', 'fat', 115, 0.8, 6, 10.7, [], { ...V, unit: { g: 4, name: 'olive' } }),
  F('pistachios', 'Pistachios', 'فستق', 'fat', 560, 20, 28, 45, [], { tags: ['nuts', 'pricey'], ...V }),
  F('hazelnuts', 'Hazelnuts', 'بندق', 'fat', 628, 15, 17, 61, [], { tags: ['nuts'], ...V }),
  F('pumpkin-seeds', 'Pumpkin seeds (lib abyad)', 'لب أبيض', 'fat', 559, 30, 11, 49, [], V),
  F('chia', 'Chia seeds', 'بذور الشيا', 'fat', 486, 17, 42, 31, [], { tags: ['pricey'], ...V }),

  // ---------------------------------------------------------------- sweet things (logging and treats)
  F('honey', 'Honey', 'عسل نحل', 'sweet', 304, 0.3, 82, 0, ['sweet'], { ...V, step: 5, portion: [10, 15, 30], unit: { g: 21, name: 'tbsp' } }),
  F('molasses', 'Black molasses (asal eswed)', 'عسل أسود', 'sweet', 290, 0, 75, 0.1, ['sweet'], { ...V, step: 5, portion: [10, 20, 40] }),
  F('jam', 'Jam', 'مربى', 'sweet', 278, 0.4, 69, 0.1, ['sweet'], { ...V, step: 5, portion: [10, 20, 30] }),
  F('halawa', 'Halawa (tahini halva)', 'حلاوة طحينية', 'sweet', 469, 12, 53, 23, ['sweet'], { tags: ['sesame'], ...V, step: 5, portion: [20, 30, 50] }),
  F('chocolate-spread', 'Chocolate hazelnut spread', 'شوكولاتة دهن', 'sweet', 539, 6.3, 57.5, 31, ['sweet'], { tags: ['nuts', 'dairy'], ...V, step: 5, portion: [15, 20, 30] }),
  F('dark-chocolate', 'Dark chocolate', 'شوكولاتة داكنة', 'sweet', 546, 4.9, 61, 31, ['sweet'], { tags: ['pricey', 'dairy'], ...V, step: 5, portion: [10, 20, 30] }),
  F('basbousa', 'Basbousa', 'بسبوسة', 'sweet', 350, 4, 55, 13, ['sweet'], { tags: ['gluten', 'dairy'], ...V, step: 10, portion: [60, 80, 120], est: true }),
  F('konafa', 'Konafa', 'كنافة', 'sweet', 400, 6, 50, 20, ['sweet'], { tags: ['gluten', 'dairy', 'nuts'], ...V, step: 10, portion: [60, 100, 150], est: true }),
  F('om-ali', 'Om Ali', 'أم علي', 'sweet', 230, 6, 26, 12, ['sweet'], { tags: ['gluten', 'dairy', 'nuts'], ...V, step: 10, portion: [150, 200, 250], est: true }),
  F('sugar', 'Sugar', 'سكر', 'sweet', 387, 0, 100, 0, ['sweet'], { ...V, step: 5, portion: [5, 10, 20], unit: { g: 5, name: 'tsp' } }),
  F('popcorn', 'Popcorn, air-popped', 'فشار', 'snack', 387, 13, 78, 4.5, ['snack'], { ...V, step: 5, portion: [15, 25, 40] }),
  F('cola', 'Cola', 'كولا', 'sweet', 42, 0, 10.6, 0, ['sweet'], { ...V, step: 50, portion: [330, 330, 330], unit: { g: 330, name: 'can' } }),
];

// `measures` only lives in code (measures.js reads it by id), so it is left off the food rows.
export const FOODS = [...BASE_FOODS, ...MORE_DIET_FOODS.map(({ measures, ...f }) => f)];

/** Food groups people can exclude. The key is the tag stored on each food. */
export const EXCLUDE_GROUPS = [
  ['meat', 'Red meat'], ['poultry', 'Chicken & turkey'], ['fish', 'Fish'], ['seafood', 'Shrimp & seafood'],
  ['organ', 'Liver & organ meat'], ['egg', 'Eggs'], ['dairy', 'Milk & dairy'], ['gluten', 'Wheat / gluten'],
  ['nuts', 'Tree nuts'], ['peanut', 'Peanuts'], ['sesame', 'Sesame & tahini'], ['soy', 'Soy'],
];
export const ALLERGEN_TAGS = EXCLUDE_GROUPS.map(([k]) => k);
