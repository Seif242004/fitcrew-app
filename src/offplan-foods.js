// Logging-only foods ("off-plan"): everything people eat or drink that a diet plan is not built
// from. Pizza, burgers, fried chicken, sweets and snacks, but also everyday things: coffee and tea
// drinks, juices, sauces and cooking oil, bakery breads, home dishes and street sandwiches. They
// exist so a day can be logged accurately in one tap instead of guessed or hidden, and they never
// earn points (see adherence.js).
//
// They are NEVER used to build or change a plan: `offplan: true` keeps them out of loadFoods()
// by default, so the plan generator, swaps, "Change meal", AI menus and the plan checker never
// see them, and they have no meal roles. Only food search, logging and by-id lookups include them.
//
// Values are per 100 g as eaten, generic (no brand names): averages of USDA FoodData Central
// fast-food and bakery entries and the published nutrition of the big chains sold in Egypt.
// Portions are typical servings there. Marked est: true; the admin can edit any value.
//
// (Since session 13 they can earn points inside a meal that still matches its plan; see
// OFFPLAN_MEAL_MATCH in adherence.js.)
//
// Fields as in foods-seed.js; `unit` is the natural count (1 slice, 1 nugget, 1 can) and
// `measures` are extra ways to log it ([name, plural, grams, half]).

const O = (id, name, ar, cat, kcal, p, c, f, unit, o = {}) => ({
  id, name, ar, cat, kcal, p, c, f, roles: [],
  tags: o.tags ?? [], veg: o.veg ?? false, step: o.step ?? 5, max: o.max ?? 1500,
  portion: null, unit: { g: unit[1], name: unit[0] }, est: true, raw: null, offplan: true,
  measures: o.m ?? [],
});
const M = (name, plural, g, half = false) => [name, plural, g, half];
const V = { veg: true };

import { MORE_OFFPLAN_FOODS } from './offplan-more.js';

// The original list; MORE_OFFPLAN_FOODS (offplan-more.js) adds chains, street food and more.
const BASE_OFFPLAN = [
  // ---------------------------------------------------------------- pizza & pasta
  O('pizza-margherita', 'Pizza, margherita (cheese)', 'بيتزا مارجريتا', 'fastfood', 266, 11.4, 33.3, 9.7, ['slice', 107], { tags: ['gluten', 'dairy'], ...V, m: [M('personal pizza', 'personal pizzas', 300), M('medium pizza', 'medium pizzas', 640)] }),
  O('pizza-pepperoni', 'Pizza, pepperoni', 'بيتزا بيبروني', 'fastfood', 298, 12.9, 32.3, 12.9, ['slice', 110], { tags: ['gluten', 'dairy', 'meat'], m: [M('personal pizza', 'personal pizzas', 310), M('medium pizza', 'medium pizzas', 660)] }),
  O('pizza-chicken', 'Pizza, chicken & vegetables', 'بيتزا فراخ وخضار', 'fastfood', 250, 12, 30, 9, ['slice', 115], { tags: ['gluten', 'dairy', 'poultry'], m: [M('personal pizza', 'personal pizzas', 320), M('medium pizza', 'medium pizzas', 690)] }),
  O('pizza-supreme', 'Pizza, supreme (meat & vegetables)', 'بيتزا سوبريم', 'fastfood', 275, 12.5, 30, 12, ['slice', 120], { tags: ['gluten', 'dairy', 'meat'], m: [M('personal pizza', 'personal pizzas', 330), M('medium pizza', 'medium pizzas', 720)] }),
  O('pasta-negresco', 'Pasta negresco (chicken & béchamel)', 'مكرونة نجرسكو', 'fastfood', 190, 9, 17, 9.5, ['tray', 350], { tags: ['gluten', 'dairy', 'poultry'], m: [M('half tray', 'half trays', 175)] }),
  O('pasta-alfredo', 'Chicken alfredo pasta', 'مكرونة ألفريدو بالفراخ', 'fastfood', 180, 9, 16, 9, ['plate', 350], { tags: ['gluten', 'dairy', 'poultry'] }),
  O('garlic-bread', 'Garlic bread', 'عيش بالثوم', 'fastfood', 350, 8, 42, 17, ['piece', 30], { tags: ['gluten', 'dairy'], ...V }),

  // ---------------------------------------------------------------- burgers & sandwiches
  O('beef-burger', 'Beef burger, single patty', 'برجر لحمة', 'fastfood', 254, 13, 26, 11, ['burger', 120], { tags: ['gluten', 'meat'] }),
  O('cheeseburger-double', 'Double cheeseburger', 'دبل تشيز برجر', 'fastfood', 270, 15.3, 21, 14, ['burger', 165], { tags: ['gluten', 'meat', 'dairy'] }),
  O('burger-restaurant', 'Big beef burger with sauce (restaurant)', 'برجر كبير بالصوص', 'fastfood', 245, 13, 17, 14, ['burger', 280], { tags: ['gluten', 'meat', 'dairy', 'egg'] }),
  O('chicken-burger-crispy', 'Crispy chicken burger', 'ساندوتش فراخ كرسبي', 'fastfood', 260, 11, 26, 12.5, ['sandwich', 200], { tags: ['gluten', 'poultry', 'egg'] }),
  O('chicken-sandwich-grilled', 'Grilled chicken sandwich', 'ساندوتش فراخ مشوية', 'fastfood', 185, 14, 20, 5.5, ['sandwich', 200], { tags: ['gluten', 'poultry'] }),
  O('beef-shawarma', 'Beef shawarma sandwich', 'ساندوتش شاورما لحمة', 'fastfood', 230, 12.5, 20, 11, ['sandwich', 200], { tags: ['gluten', 'meat', 'sesame'], m: [M('large sandwich', 'large sandwiches', 300)] }),
  O('hot-dog', 'Hot dog in a bun', 'هوت دوج', 'fastfood', 290, 10.5, 22, 18, ['hot dog', 100], { tags: ['gluten', 'meat'] }),
  O('crepe-savory', 'Savoury crepe (chicken & cheese)', 'كريب فراخ وجبنة', 'fastfood', 215, 11, 23, 9, ['crepe', 300], { tags: ['gluten', 'dairy', 'poultry', 'egg'] }),

  // ---------------------------------------------------------------- fried chicken & sides
  O('fried-chicken', 'Fried chicken, crispy', 'فراخ مقلية كرسبي', 'fastfood', 260, 20, 10, 16, ['piece', 110], { tags: ['gluten', 'poultry'], m: [M('2-piece meal (no fries)', '2-piece meals', 220)] }),
  O('chicken-nuggets', 'Chicken nuggets', 'ناجتس فراخ', 'fastfood', 296, 15.3, 16.3, 19, ['nugget', 16], { tags: ['gluten', 'poultry'], m: [M('6-piece box', '6-piece boxes', 96), M('9-piece box', '9-piece boxes', 144)] }),
  O('chicken-strips', 'Crispy chicken strips', 'استربس فراخ', 'fastfood', 270, 18, 15, 15, ['strip', 45], { tags: ['gluten', 'poultry'] }),
  O('chicken-wings', 'Chicken wings, fried or buffalo', 'أجنحة فراخ', 'fastfood', 290, 22, 5, 20, ['wing', 32], { tags: ['poultry'] }),
  O('fries', 'French fries', 'بطاطس محمرة', 'fastfood', 312, 3.4, 41, 15, ['medium portion', 117], { ...V, m: [M('small portion', 'small portions', 80), M('large portion', 'large portions', 150)] }),
  O('onion-rings', 'Onion rings', 'حلقات بصل', 'fastfood', 411, 4.5, 39, 26, ['portion', 90], { tags: ['gluten'], ...V }),
  O('mozzarella-sticks', 'Mozzarella sticks', 'أصابع موتزاريلا', 'fastfood', 330, 14, 26, 19, ['stick', 25], { tags: ['gluten', 'dairy'], ...V }),
  O('coleslaw', 'Coleslaw', 'كول سلو', 'fastfood', 150, 1, 13, 10.5, ['small cup', 100], { tags: ['egg'], ...V }),

  // ---------------------------------------------------------------- sweets & bakery
  O('milk-chocolate', 'Milk chocolate bar', 'شوكولاتة باللبن', 'sweets', 535, 7.6, 59, 30, ['bar', 45], { tags: ['dairy'], ...V, m: [M('small bar', 'small bars', 25), M('large bar', 'large bars', 100)] }),
  O('wafer-chocolate', 'Chocolate-coated wafer bar', 'ويفر بالشوكولاتة', 'sweets', 518, 6.5, 61, 27, ['bar', 42], { tags: ['gluten', 'dairy'], ...V, m: [M('2-finger bar', '2-finger bars', 21)] }),
  O('caramel-nut-bar', 'Chocolate bar with caramel & peanuts', 'شوكولاتة بالكراميل والفول السوداني', 'sweets', 488, 9.4, 60, 24, ['bar', 50], { tags: ['dairy', 'peanut'], ...V }),
  O('cream-biscuits', 'Chocolate cream sandwich biscuits', 'بسكويت شوكولاتة بالكريمة', 'sweets', 473, 5, 69, 20, ['biscuit', 11], { tags: ['gluten'], ...V, m: [M('small pack', 'small packs', 38)] }),
  O('gummies', 'Gummy candy', 'جيلي حلويات', 'sweets', 343, 6.9, 77, 0.5, ['handful', 25], { m: [M('small pack', 'small packs', 50)] }),
  O('hard-candy', 'Hard candy', 'بونبون', 'sweets', 394, 0, 98, 0.2, ['piece', 6], V),
  O('cookie', 'Chocolate chip cookie', 'كوكيز بالشوكولاتة', 'sweets', 488, 5.4, 64, 24, ['cookie', 30], { tags: ['gluten', 'dairy', 'egg'], ...V, m: [M('large bakery cookie', 'large bakery cookies', 70)] }),
  O('croissant', 'Croissant, plain', 'كرواسون سادة', 'sweets', 406, 8.2, 45.8, 21, ['croissant', 60], { tags: ['gluten', 'dairy', 'egg'], ...V }),
  O('croissant-chocolate', 'Chocolate croissant', 'كرواسون بالشوكولاتة', 'sweets', 420, 7.5, 46, 22, ['croissant', 70], { tags: ['gluten', 'dairy', 'egg'], ...V }),
  O('donut', 'Donut, glazed', 'دونات', 'sweets', 403, 5.6, 51, 19, ['donut', 52], { tags: ['gluten', 'dairy', 'egg'], ...V, m: [M('filled donut', 'filled donuts', 80)] }),
  O('chocolate-cake', 'Chocolate cake with frosting', 'كيكة شوكولاتة', 'sweets', 371, 5, 51, 17, ['slice', 95], { tags: ['gluten', 'dairy', 'egg'], ...V }),
  O('cheesecake', 'Cheesecake', 'تشيز كيك', 'sweets', 321, 5.5, 25.5, 22.5, ['slice', 125], { tags: ['gluten', 'dairy', 'egg'], ...V }),
  O('brownie', 'Chocolate brownie', 'براونيز', 'sweets', 466, 6, 56, 25, ['piece', 60], { tags: ['gluten', 'dairy', 'egg'], ...V }),
  O('ice-cream', 'Ice cream, vanilla or chocolate', 'آيس كريم', 'sweets', 207, 3.5, 23.6, 11, ['scoop', 66], { tags: ['dairy'], ...V, m: [M('cone', 'cones', 110), M('cup (2 scoops)', 'cups', 132)] }),
  O('waffle-chocolate', 'Waffle with chocolate spread', 'وافل بالشوكولاتة', 'sweets', 330, 6, 42, 15, ['waffle', 150], { tags: ['gluten', 'dairy', 'egg', 'nuts'], ...V }),
  O('crepe-sweet', 'Sweet crepe (chocolate)', 'كريب شوكولاتة', 'sweets', 330, 6, 42, 15, ['crepe', 200], { tags: ['gluten', 'dairy', 'egg', 'nuts'], ...V }),
  O('zalabya', 'Zalabya (lokma)', 'زلابية', 'sweets', 330, 4, 45, 15, ['piece', 12], { tags: ['gluten'], ...V, m: [M('plate of 10', 'plates of 10', 120)] }),
  O('qatayef', 'Qatayef with nuts, fried', 'قطايف بالمكسرات', 'sweets', 320, 6, 40, 15, ['piece', 50], { tags: ['gluten', 'nuts'], ...V }),
  O('rice-pudding', 'Rice pudding (roz bel laban)', 'رز بلبن', 'sweets', 130, 3.5, 21, 3.5, ['cup', 200], { tags: ['dairy'], ...V }),
  O('meshabek', 'Meshabek / goulash sweet', 'مشبك', 'sweets', 420, 3, 60, 19, ['piece', 30], { tags: ['gluten'], ...V }),

  // ---------------------------------------------------------------- snacks
  O('potato-chips', 'Potato chips', 'شيبسي', 'snacks', 536, 7, 53, 34.6, ['small bag', 30], { ...V, m: [M('large bag', 'large bags', 80)] }),
  O('cheese-puffs', 'Cheese puffs (corn snack)', 'كرانشي بالجبنة', 'snacks', 540, 6, 55, 33, ['bag', 30], { tags: ['dairy'], ...V }),
  O('salted-crackers', 'Salted crackers', 'بسكويت مملح', 'snacks', 434, 9, 72, 12, ['small pack', 30], { tags: ['gluten'], ...V }),
  O('cake-bar', 'Packaged cake bar (sponge with cream)', 'كيك معبأ', 'snacks', 420, 5, 55, 20, ['piece', 45], { tags: ['gluten', 'dairy', 'egg'], ...V }),

  // ---------------------------------------------------------------- drinks
  O('fizzy-drink', 'Fizzy drink, orange or lemon', 'مياه غازية برتقال أو ليمون', 'drinks', 48, 0, 12, 0, ['can', 330], { ...V, m: [M('small bottle', 'small bottles', 250), M('1 L bottle', '1 L bottles', 1000)] }),
  O('energy-drink', 'Energy drink', 'مشروب طاقة', 'drinks', 45, 0, 11, 0, ['can', 250], V),
  O('juice-packaged', 'Juice, packaged (orange, mango, guava)', 'عصير معبأ', 'drinks', 50, 0.4, 12, 0.1, ['pack', 235], { ...V, m: [M('glass', 'glasses', 250)] }),
  O('mango-juice', 'Mango juice (juice shop)', 'عصير مانجا', 'drinks', 65, 0.5, 16, 0.1, ['glass', 350], V),
  O('sugarcane-juice', 'Sugarcane juice (asab)', 'عصير قصب', 'drinks', 73, 0, 18, 0, ['glass', 300], V),
  O('latte', 'Caffè latte, whole milk', 'لاتيه', 'drinks', 54, 3, 4.5, 2.8, ['medium cup', 350], { tags: ['dairy'], ...V, m: [M('large cup', 'large cups', 470)] }),
  O('frappe', 'Blended iced coffee with cream (frappé)', 'فرابيه', 'drinks', 80, 1.1, 13, 3, ['medium cup', 470], { tags: ['dairy'], ...V }),
  O('hot-chocolate', 'Hot chocolate', 'هوت شوكليت', 'drinks', 77, 3.5, 11, 2.3, ['mug', 300], { tags: ['dairy'], ...V }),
  O('milkshake', 'Milkshake (chocolate, vanilla or strawberry)', 'ميلك شيك', 'drinks', 119, 3.2, 19, 3.5, ['cup', 400], { tags: ['dairy'], ...V }),
  O('sobia', 'Sobia (coconut rice drink)', 'سوبيا', 'drinks', 90, 1, 17, 2.5, ['glass', 300], { tags: ['dairy'], ...V }),

  // ---------------------------------------------------------------- coffee, tea & everyday drinks
  O('coffee-black', 'Coffee, black (Turkish or americano)', 'قهوة سادة', 'drinks', 2, 0.1, 0, 0, ['cup', 60], { ...V, m: [M('mug', 'mugs', 240)] }),
  O('turkish-coffee-sugar', 'Turkish coffee with sugar (mazboot)', 'قهوة تركي مظبوط', 'drinks', 28, 0.1, 7, 0, ['cup', 70], V),
  O('espresso', 'Espresso', 'إسبريسو', 'drinks', 9, 0.1, 1.7, 0.2, ['shot', 30], { ...V, m: [M('double shot', 'double shots', 60)] }),
  O('cappuccino', 'Cappuccino, whole milk', 'كابتشينو', 'drinks', 40, 2.2, 3.3, 2.1, ['cup', 240], { tags: ['dairy'], ...V, m: [M('large cup', 'large cups', 350)] }),
  O('spanish-latte', 'Spanish latte (condensed milk)', 'سبانش لاتيه', 'drinks', 72, 2.6, 10, 2.4, ['medium cup', 350], { tags: ['dairy'], ...V }),
  O('mocha', 'Caffè mocha', 'موكا', 'drinks', 80, 3, 10.5, 3.2, ['medium cup', 350], { tags: ['dairy'], ...V }),
  O('caramel-macchiato', 'Caramel macchiato', 'كراميل ماكياتو', 'drinks', 68, 2.6, 9.5, 2.2, ['medium cup', 350], { tags: ['dairy'], ...V }),
  O('iced-coffee', 'Iced coffee with milk, sweetened', 'آيس كوفي', 'drinks', 50, 1.6, 7, 1.6, ['cup', 350], { tags: ['dairy'], ...V }),
  O('nescafe-3in1', 'Coffee mix 3-in-1 (Nescafé type)', 'نسكافيه ٣ في ١', 'drinks', 440, 4, 72, 15, ['sachet', 18], { tags: ['dairy'], ...V }),
  O('instant-coffee', 'Instant coffee, black (Nescafé)', 'نسكافيه سادة', 'drinks', 2, 0.1, 0.3, 0, ['mug', 250], V),
  O('nescafe-milk', 'Nescafé with milk, no sugar', 'نسكافيه باللبن', 'drinks', 31, 1.6, 2.4, 1.6, ['mug', 250], { tags: ['dairy'], ...V }),
  O('tea', 'Tea, no sugar (black, green or herbal)', 'شاي سادة', 'drinks', 1, 0, 0.2, 0, ['cup', 200], V),
  O('tea-sugar', 'Tea with 2 tsp sugar', 'شاي بسكر', 'drinks', 20, 0, 5, 0, ['cup', 200], V),
  O('tea-milk', 'Tea with milk, no sugar', 'شاي بلبن', 'drinks', 16, 0.8, 1.3, 0.8, ['cup', 250], { tags: ['dairy'], ...V }),
  O('karkade', 'Hibiscus (karkade), sweetened', 'كركديه', 'drinks', 40, 0, 10, 0, ['glass', 250], V),
  O('sahlab', 'Sahlab', 'سحلب', 'drinks', 105, 3, 16, 3.3, ['cup', 250], { tags: ['dairy', 'nuts'], ...V }),
  O('lemon-mint', 'Lemon mint juice', 'ليمون نعناع', 'drinks', 45, 0.1, 11.5, 0, ['glass', 300], V),
  O('strawberry-juice', 'Strawberry juice (juice shop)', 'عصير فراولة', 'drinks', 60, 0.6, 14, 0.3, ['glass', 350], V),
  O('guava-juice', 'Guava juice (juice shop)', 'عصير جوافة', 'drinks', 65, 0.5, 15.5, 0.3, ['glass', 350], V),
  O('cocktail-juice', 'Fruit cocktail juice', 'عصير كوكتيل', 'drinks', 85, 1, 18, 1, ['glass', 400], { tags: ['dairy'], ...V }),
  O('tamarind', 'Tamarind drink (tamr hindi)', 'تمر هندي', 'drinks', 50, 0.2, 12.5, 0, ['glass', 250], V),
  O('kharoub', 'Carob drink (kharoub)', 'خروب', 'drinks', 50, 0.3, 12.5, 0, ['glass', 250], V),
  O('qamar-eldin', 'Apricot drink (qamar el-din)', 'قمر الدين', 'drinks', 65, 0.5, 16, 0, ['glass', 250], V),
  O('diet-cola', 'Diet or zero cola', 'كولا دايت', 'drinks', 0.4, 0, 0.1, 0, ['can', 330], V),
  O('malt-drink', 'Malt drink, non-alcoholic', 'بيرة شعير', 'drinks', 40, 0.4, 9.5, 0, ['can', 330], { tags: ['gluten'], ...V }),
  O('iced-tea', 'Iced tea, bottled', 'آيس تي', 'drinks', 30, 0, 7.5, 0, ['bottle', 330], V),
  O('chocolate-milk', 'Chocolate milk', 'لبن بالشوكولاتة', 'drinks', 75, 3.2, 11, 2, ['bottle', 250], { tags: ['dairy'], ...V }),
  O('smoothie', 'Fruit smoothie with yogurt', 'سموذي', 'drinks', 75, 2.5, 14, 1, ['cup', 400], { tags: ['dairy'], ...V }),
  O('sports-drink', 'Sports drink', 'مشروب رياضي', 'drinks', 25, 0, 6, 0, ['bottle', 500], V),

  // ---------------------------------------------------------------- sauces, spreads & cooking extras
  O('ketchup', 'Ketchup', 'كاتشب', 'basics', 112, 1.7, 26, 0.1, ['tbsp', 17], { ...V, m: [M('sachet', 'sachets', 10)] }),
  O('mayonnaise', 'Mayonnaise', 'مايونيز', 'basics', 680, 1, 0.6, 75, ['tbsp', 14], { tags: ['egg'], ...V, m: [M('sachet', 'sachets', 10)] }),
  O('mayonnaise-light', 'Mayonnaise, light', 'مايونيز لايت', 'basics', 280, 0.5, 9, 26, ['tbsp', 15], { tags: ['egg'], ...V }),
  O('mustard', 'Mustard', 'مسطردة', 'basics', 66, 4, 5.8, 3.3, ['tsp', 5], V),
  O('bbq-sauce', 'Barbecue sauce', 'صوص باربكيو', 'basics', 170, 0.8, 41, 0.6, ['tbsp', 17], V),
  O('hot-sauce', 'Hot sauce (shatta)', 'شطة', 'basics', 12, 0.5, 1.8, 0.4, ['tsp', 5], V),
  O('garlic-sauce', 'Garlic sauce (toum)', 'صوص ثومية', 'basics', 450, 1, 6, 47, ['tbsp', 15], V),
  O('soy-sauce', 'Soy sauce', 'صويا صوص', 'basics', 53, 8, 5, 0.6, ['tbsp', 16], { tags: ['soy', 'gluten'], ...V }),
  O('sweet-chili', 'Sweet chili sauce', 'صوص سويت تشيلي', 'basics', 230, 0.5, 55, 0.5, ['tbsp', 18], V),
  O('caesar-dressing', 'Caesar dressing', 'صوص سيزر', 'basics', 480, 2, 4, 50, ['tbsp', 15], { tags: ['egg', 'dairy', 'fish'] }),
  O('cooking-oil', 'Cooking oil (sunflower or corn)', 'زيت طبخ', 'basics', 884, 0, 0, 100, ['tbsp', 14], { ...V, m: [M('tsp', 'tsp', 5)] }),
  O('cream', 'Cream (cooking or whipping)', 'كريمة', 'basics', 300, 2.2, 3, 31, ['tbsp', 15], { tags: ['dairy'], ...V }),
  O('cream-cheese', 'Cream cheese spread', 'جبنة كريمي', 'basics', 342, 6, 5.5, 34, ['tbsp', 15], { tags: ['dairy'], ...V }),
  O('coffee-creamer', 'Coffee creamer powder', 'كوفي ميت', 'basics', 545, 2.4, 56, 35, ['tsp', 3], { tags: ['dairy'], ...V }),
  O('condensed-milk', 'Sweetened condensed milk', 'لبن مكثف محلى', 'basics', 321, 7.9, 54, 8.7, ['tbsp', 20], { tags: ['dairy'], ...V }),
  O('sweetener', 'Sweetener (diet sugar)', 'سكر دايت', 'basics', 0, 0, 0, 0, ['sachet', 1], V),

  // ---------------------------------------------------------------- bread & bakery
  O('samoli', 'Samoli bread (sub roll)', 'عيش سمولي', 'bakery', 280, 9, 55, 2.5, ['roll', 90], { tags: ['gluten', 'sesame'], ...V }),
  O('burger-bun', 'Burger bun', 'عيش برجر', 'bakery', 279, 9.5, 50, 4.3, ['bun', 55], { tags: ['gluten', 'sesame'], ...V }),
  O('simit', 'Simit (sesame bread ring)', 'سميط', 'bakery', 300, 9, 55, 5, ['ring', 100], { tags: ['gluten', 'sesame'], ...V }),
  O('rusks', 'Rusks (baksamat)', 'بقسماط', 'bakery', 410, 12, 72, 8, ['piece', 10], { tags: ['gluten'], ...V }),
  O('pate', 'Cheese pastry (pâté)', 'باتيه بالجبنة', 'bakery', 380, 8, 40, 21, ['piece', 90], { tags: ['gluten', 'dairy'], ...V }),
  O('manakish', 'Za\'atar manakish', 'مناقيش زعتر', 'bakery', 350, 8, 45, 15, ['piece', 120], { tags: ['gluten', 'sesame'], ...V }),
  O('croissant-cheese', 'Cheese croissant', 'كرواسون جبنة', 'bakery', 400, 10, 38, 23, ['croissant', 80], { tags: ['gluten', 'dairy', 'egg'], ...V }),
  O('muffin', 'Muffin', 'مافن', 'bakery', 400, 5, 53, 19, ['muffin', 90], { tags: ['gluten', 'dairy', 'egg'], ...V }),
  O('pancakes', 'Pancakes', 'بان كيك', 'bakery', 227, 6.4, 28, 9.7, ['pancake', 40], { tags: ['gluten', 'dairy', 'egg'], ...V }),
  O('cinnamon-roll', 'Cinnamon roll', 'سينابون', 'bakery', 380, 6, 50, 17, ['roll', 100], { tags: ['gluten', 'dairy', 'egg'], ...V }),
  O('digestive', 'Digestive biscuits', 'بسكويت دايجستف', 'bakery', 480, 7, 63, 21, ['biscuit', 15], { tags: ['gluten'], ...V }),
  O('tea-biscuits', 'Plain tea biscuits', 'بسكويت شاي', 'bakery', 440, 7, 73, 13, ['biscuit', 8], { tags: ['gluten'], ...V }),

  // ---------------------------------------------------------------- home cooking & restaurants
  O('chicken-pane', 'Chicken pané (breaded, fried)', 'فراخ بانيه', 'meals', 260, 22, 13, 13, ['piece', 100], { tags: ['gluten', 'poultry', 'egg'] }),
  O('fried-fish', 'Fried fish (bolti or bouri)', 'سمك مقلي', 'meals', 230, 21, 6, 13, ['fish', 200], { tags: ['fish', 'gluten'] }),
  O('fried-calamari', 'Fried calamari', 'كاليماري مقلي', 'meals', 260, 13, 22, 13, ['portion', 150], { tags: ['seafood', 'gluten'] }),
  O('fried-shrimp', 'Fried shrimp', 'جمبري مقلي', 'meals', 260, 18, 15, 14, ['portion', 150], { tags: ['seafood', 'gluten'] }),
  O('sayadeya', 'Sayadeya rice (fish rice)', 'أرز صيادية', 'meals', 165, 4, 28, 4, ['cup', 160], V),
  O('moussaka', 'Moussaka (mesa\'a\'a)', 'مسقعة', 'meals', 140, 2, 9, 11, ['portion', 250], V),
  O('mombar', 'Mombar (stuffed sausage)', 'ممبار', 'meals', 290, 9, 30, 15, ['piece', 50], { tags: ['meat', 'organ'] }),
  O('kobeba', 'Kobeba (fried kibbeh)', 'كبيبة', 'meals', 300, 13, 25, 17, ['piece', 50], { tags: ['meat', 'gluten'] }),
  O('sambousek', 'Sambousek (cheese or meat)', 'سمبوسك', 'meals', 330, 9, 30, 19, ['piece', 30], { tags: ['gluten', 'dairy'] }),
  O('spring-rolls', 'Spring rolls, fried', 'سبرنج رولز', 'meals', 260, 7, 26, 14, ['piece', 40], { tags: ['gluten'], ...V }),
  O('goulash-meat', 'Goulash with meat (filo pie)', 'جلاش باللحمة', 'meals', 300, 11, 22, 19, ['piece', 120], { tags: ['gluten', 'meat', 'dairy'] }),
  O('potato-tray', 'Potatoes and meat tray (saneyet batates)', 'صينية بطاطس باللحمة', 'meals', 130, 7, 10, 7, ['plate', 300], { tags: ['meat'] }),
  O('kabsa', 'Chicken with rice (kabsa or mandi)', 'كبسة فراخ', 'meals', 170, 10, 18, 6, ['plate', 450], { tags: ['poultry'] }),
  O('shawarma-plate', 'Shawarma plate (with fries and bread)', 'وجبة شاورما', 'meals', 220, 12, 18, 11, ['plate', 450], { tags: ['gluten', 'sesame'] }),
  O('chicken-quarter-rice', 'Grilled chicken quarter with rice', 'ربع فرخة مشوية بالأرز', 'meals', 175, 14, 14, 7, ['meal', 450], { tags: ['poultry'] }),
  O('chicken-soup', 'Chicken soup with orzo', 'شوربة فراخ لسان عصفور', 'meals', 45, 3, 5, 1.5, ['bowl', 300], { tags: ['poultry', 'gluten'] }),
  O('cream-soup', 'Cream soup (mushroom or chicken)', 'شوربة كريمة', 'meals', 70, 1.5, 6, 4.5, ['bowl', 300], { tags: ['dairy', 'gluten'] }),
  O('lasagna', 'Lasagna', 'لازانيا', 'meals', 160, 9, 14, 8, ['piece', 250], { tags: ['gluten', 'dairy', 'meat'] }),
  O('pasta-red-sauce', 'Pasta with tomato sauce', 'مكرونة صلصة', 'meals', 140, 4.5, 24, 3, ['plate', 300], { tags: ['gluten'], ...V }),
  O('pasta-bolognese', 'Pasta bolognese', 'مكرونة بولونيز', 'meals', 150, 7, 18, 5.5, ['plate', 350], { tags: ['gluten', 'meat'] }),
  O('fried-rice', 'Fried rice with chicken (Chinese)', 'أرز مقلي صيني', 'meals', 170, 7, 22, 6, ['plate', 350], { tags: ['poultry', 'egg', 'soy'] }),
  O('sushi', 'Sushi roll', 'سوشي', 'meals', 150, 5, 26, 3, ['piece', 30], { tags: ['fish', 'seafood'] }),
  O('instant-noodles', 'Instant noodles (Indomie type)', 'إندومي', 'meals', 450, 9, 60, 19, ['pack', 75], { tags: ['gluten'], ...V }),
  O('chicken-fajita', 'Chicken fajita wrap', 'فاهيتا فراخ', 'meals', 200, 12, 20, 8, ['wrap', 250], { tags: ['gluten', 'poultry', 'dairy'] }),
  O('caesar-salad', 'Chicken caesar salad', 'سلطة سيزر بالفراخ', 'meals', 140, 11, 6, 8, ['bowl', 300], { tags: ['poultry', 'dairy', 'gluten', 'egg'] }),
  O('fried-eggplant', 'Fried eggplant (betengan)', 'بتنجان مقلي', 'meals', 230, 1.3, 9, 21, ['portion', 100], V),
  O('fried-cauliflower', 'Fried cauliflower', 'قرنبيط مقلي', 'meals', 190, 3, 11, 15, ['portion', 100], { tags: ['egg', 'gluten'], ...V }),
  O('luncheon', 'Luncheon meat', 'لانشون', 'meals', 250, 12, 4, 21, ['slice', 20], { tags: ['meat'] }),
  O('basterma', 'Pastrami (basterma)', 'بسطرمة', 'meals', 250, 25, 2, 16, ['slice', 15], { tags: ['meat'] }),
  O('sausage', 'Sausage (sogo\'), cooked', 'سجق', 'meals', 300, 14, 3, 26, ['piece', 50], { tags: ['meat'] }),
  O('burger-patty', 'Beef burger patty, home-cooked', 'بيف برجر', 'meals', 250, 17, 3, 19, ['patty', 100], { tags: ['meat'] }),

  // ---------------------------------------------------------------- Egyptian street sandwiches
  O('ful-sandwich', 'Ful sandwich', 'ساندوتش فول', 'fastfood', 180, 7, 28, 4, ['sandwich', 150], { tags: ['gluten'], ...V }),
  O('taameya-sandwich', 'Taameya sandwich', 'ساندوتش طعمية', 'fastfood', 240, 7, 30, 10, ['sandwich', 150], { tags: ['gluten', 'sesame'], ...V }),
  O('potato-sandwich', 'Fried potato sandwich', 'ساندوتش بطاطس', 'fastfood', 270, 5, 37, 11, ['sandwich', 160], { tags: ['gluten'], ...V }),
  O('egg-sandwich', 'Egg sandwich', 'ساندوتش بيض', 'fastfood', 230, 9, 26, 10, ['sandwich', 150], { tags: ['gluten', 'egg'], ...V }),
  O('cheese-sandwich', 'Cheese sandwich (white or roumy)', 'ساندوتش جبنة', 'fastfood', 260, 11, 30, 10, ['sandwich', 120], { tags: ['gluten', 'dairy'], ...V }),
  O('tuna-sandwich', 'Tuna sandwich', 'ساندوتش تونة', 'fastfood', 220, 12, 24, 8, ['sandwich', 180], { tags: ['gluten', 'fish'] }),
  O('sausage-sandwich', 'Sausage sandwich (sogo\')', 'ساندوتش سجق', 'fastfood', 280, 10, 25, 15, ['sandwich', 180], { tags: ['gluten', 'meat'] }),

  // ---------------------------------------------------------------- more sweets
  O('mehalabeya', 'Mehalabeya (milk pudding)', 'مهلبية', 'sweets', 130, 3.5, 21, 3.5, ['cup', 150], { tags: ['dairy'], ...V }),
  O('cream-caramel', 'Crème caramel', 'كريم كراميل', 'sweets', 140, 4, 22, 4, ['cup', 100], { tags: ['dairy', 'egg'], ...V }),
  O('jelly', 'Jelly (jello)', 'جيلي', 'sweets', 60, 1.2, 14, 0, ['cup', 150], V),
  O('baklava', 'Baklava', 'بقلاوة', 'sweets', 430, 6, 52, 23, ['piece', 30], { tags: ['gluten', 'nuts'], ...V }),
  O('balah-elsham', 'Balah el-sham', 'بلح الشام', 'sweets', 400, 4, 50, 21, ['piece', 25], { tags: ['gluten', 'egg'], ...V }),
  O('kahk', 'Kahk (Eid cookies)', 'كحك', 'sweets', 480, 6, 58, 25, ['piece', 35], { tags: ['gluten', 'dairy'], ...V }),
  O('ghorayeba', 'Ghorayeba (butter cookies)', 'غريبة', 'sweets', 520, 5, 55, 31, ['piece', 20], { tags: ['gluten', 'dairy'], ...V }),
  O('petit-four', 'Petit four', 'بيتي فور', 'sweets', 500, 6, 60, 26, ['piece', 12], { tags: ['gluten', 'dairy', 'egg'], ...V }),
  O('maamoul', 'Date-filled cookies (maamoul)', 'معمول بالعجوة', 'sweets', 430, 5, 63, 18, ['piece', 30], { tags: ['gluten', 'dairy'], ...V }),
  O('tiramisu', 'Tiramisu', 'تيراميسو', 'sweets', 300, 5, 30, 18, ['piece', 120], { tags: ['gluten', 'dairy', 'egg'], ...V }),
  O('molten-cake', 'Molten chocolate cake', 'مولتن كيك', 'sweets', 380, 5, 40, 22, ['piece', 110], { tags: ['gluten', 'dairy', 'egg'], ...V }),
  O('ice-cream-stick', 'Ice cream on a stick, chocolate-coated', 'آيس كريم مغطى بالشوكولاتة', 'sweets', 300, 3.5, 28, 19, ['stick', 70], { tags: ['dairy'], ...V }),

  // ---------------------------------------------------------------- more snacks
  O('mixed-nuts-salted', 'Mixed salted nuts (mekassarat)', 'مكسرات مشكلة', 'snacks', 600, 18, 20, 52, ['handful', 30], { tags: ['nuts', 'peanut'], ...V }),
  O('roasted-chickpeas', 'Roasted chickpeas (hummus el-sham, dry)', 'حمص محمص', 'snacks', 370, 20, 60, 6, ['handful', 30], V),
  O('tortilla-chips', 'Tortilla chips', 'تورتيلا شيبس', 'snacks', 490, 7, 63, 23, ['small bag', 40], V),
  O('pretzels', 'Pretzels', 'بريتزل', 'snacks', 380, 10, 80, 3, ['handful', 30], { tags: ['gluten'], ...V }),
  O('granola-bar', 'Granola or cereal bar', 'جرانولا بار', 'snacks', 430, 7, 65, 15, ['bar', 30], { tags: ['gluten', 'nuts'], ...V }),
  O('fruit-yogurt', 'Fruit yogurt', 'زبادي بالفواكه', 'snacks', 95, 3.5, 15, 2.5, ['cup', 105], { tags: ['dairy'], ...V }),
  O('popcorn-butter', 'Popcorn, buttered (cinema)', 'فشار بالزبدة', 'snacks', 500, 8, 55, 28, ['small bag', 40], { tags: ['dairy'], ...V }),
];

export const OFFPLAN_FOODS = [...BASE_OFFPLAN, ...MORE_OFFPLAN_FOODS];

/** Extra measures by id, in measures.js format: { id: [{ name, plural, g, half }] }. */
export const OFFPLAN_MEASURES = Object.fromEntries(OFFPLAN_FOODS.filter((f) => f.measures.length)
  .map((f) => [f.id, f.measures.map(([name, plural, g, half]) => ({ name, plural, g, half }))]));
