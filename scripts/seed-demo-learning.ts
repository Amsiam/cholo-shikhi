// Demo learning content for the LOCAL dev database, called by scripts/seed-demo.ts: reading text,
// YouTube videos and MCQ quizzes for the demo courses, and a demo Student with three purchased
// courses and some progress. Synthetic only.
//
// Published lesson versions are immutable (NFR6.206), so content is added the way the publish path
// does it: a new published section version carrying the content, the old one superseded.
//
// Videos are placeholders from public educational channels (mostly Khan Academy), each checked to
// exist and be embeddable; real courses use the instructors' own unlisted uploads. Every quiz fact
// below is a checked, standard fact.
import type pg from 'pg';

type Lang = { en: string; bn: string };
type Question = {
  prompt: Lang;
  options: [Lang, Lang, Lang, Lang];
  correct: 0 | 1 | 2 | 3;
  explain: Lang;
};
type Bank = 'gk' | 'bangla' | 'english' | 'math' | 'physics' | 'ict' | 'science';

const L = (en: string, bn: string): Lang => ({ en, bn });
const same = (text: string): Lang => ({ en: text, bn: text });

const BANKS: Record<Bank, Question[]> = {
  gk: [
    {
      prompt: L('When did Bangladesh declare independence?', 'বাংলাদেশ কবে স্বাধীনতা ঘোষণা করে?'),
      options: [
        L('26 March 1971', '২৬ মার্চ ১৯৭১'),
        L('16 December 1971', '১৬ ডিসেম্বর ১৯৭১'),
        L('21 February 1952', '২১ ফেব্রুয়ারি ১৯৫২'),
        L('7 March 1971', '৭ মার্চ ১৯৭১'),
      ],
      correct: 0,
      explain: L(
        'Independence was declared on 26 March 1971; 16 December is Victory Day.',
        '২৬ মার্চ ১৯৭১ স্বাধীনতা ঘোষণা করা হয়; ১৬ ডিসেম্বর বিজয় দিবস।',
      ),
    },
    {
      prompt: L(
        'Into how many sectors was the battlefield divided in the Liberation War?',
        'মুক্তিযুদ্ধে রণাঙ্গনকে কয়টি সেক্টরে ভাগ করা হয়েছিল?',
      ),
      options: [L('9', '৯'), L('11', '১১'), L('7', '৭'), L('13', '১৩')],
      correct: 1,
      explain: L('The Liberation War was fought in 11 sectors.', 'মুক্তিযুদ্ধ ১১টি সেক্টরে বিভক্ত ছিল।'),
    },
    {
      prompt: L(
        'In which year was the Constitution of Bangladesh adopted?',
        'বাংলাদেশের সংবিধান কোন সালে গৃহীত হয়?',
      ),
      options: [L('1971', '১৯৭১'), L('1972', '১৯৭২'), L('1973', '১৯৭৩'), L('1975', '১৯৭৫')],
      correct: 1,
      explain: L(
        'It was adopted on 4 November 1972 and took effect on 16 December 1972.',
        'সংবিধান ৪ নভেম্বর ১৯৭২ গৃহীত হয় এবং ১৬ ডিসেম্বর ১৯৭২ কার্যকর হয়।',
      ),
    },
    {
      prompt: L('Which day is International Mother Language Day?', 'আন্তর্জাতিক মাতৃভাষা দিবস কোন দিন?'),
      options: [
        L('21 February', '২১ ফেব্রুয়ারি'),
        L('26 March', '২৬ মার্চ'),
        L('16 December', '১৬ ডিসেম্বর'),
        L('14 April', '১৪ এপ্রিল'),
      ],
      correct: 0,
      explain: L(
        'UNESCO declared 21 February International Mother Language Day in 1999.',
        'ইউনেস্কো ১৯৯৯ সালে ২১ ফেব্রুয়ারিকে আন্তর্জাতিক মাতৃভাষা দিবস ঘোষণা করে।',
      ),
    },
    {
      prompt: L(
        'Who designed the National Parliament House in Dhaka?',
        'ঢাকার জাতীয় সংসদ ভবনের স্থপতি কে?',
      ),
      options: [
        L('Muzharul Islam', 'মাজহারুল ইসলাম'),
        L('Fazlur Rahman Khan', 'ফজলুর রহমান খান'),
        L('Louis I. Kahn', 'লুই আই কান'),
        L('Hamidur Rahman', 'হামিদুর রহমান'),
      ],
      correct: 2,
      explain: L(
        'Louis I. Kahn designed it; the building was completed in 1982.',
        'লুই আই কান এর নকশা করেন; ভবনটি ১৯৮২ সালে সম্পন্ন হয়।',
      ),
    },
  ],
  bangla: [
    {
      prompt: L('Who wrote "Gitanjali"?', '"গীতাঞ্জলি" কার রচনা?'),
      options: [
        L('Kazi Nazrul Islam', 'কাজী নজরুল ইসলাম'),
        L('Rabindranath Tagore', 'রবীন্দ্রনাথ ঠাকুর'),
        L('Jibanananda Das', 'জীবনানন্দ দাশ'),
        L('Michael Madhusudan Dutt', 'মাইকেল মধুসূদন দত্ত'),
      ],
      correct: 1,
      explain: L(
        'Rabindranath Tagore wrote Gitanjali and won the Nobel Prize in Literature in 1913.',
        'রবীন্দ্রনাথ ঠাকুর গীতাঞ্জলি রচনা করেন এবং ১৯১৩ সালে সাহিত্যে নোবেল পুরস্কার পান।',
      ),
    },
    {
      prompt: L('Who is the national poet of Bangladesh?', 'বাংলাদেশের জাতীয় কবি কে?'),
      options: [
        L('Kazi Nazrul Islam', 'কাজী নজরুল ইসলাম'),
        L('Rabindranath Tagore', 'রবীন্দ্রনাথ ঠাকুর'),
        L('Jasimuddin', 'জসীমউদ্দীন'),
        L('Shamsur Rahman', 'শামসুর রাহমান'),
      ],
      correct: 0,
      explain: L(
        'Kazi Nazrul Islam is the national poet of Bangladesh.',
        'কাজী নজরুল ইসলাম বাংলাদেশের জাতীয় কবি।',
      ),
    },
    {
      prompt: L(
        'What is the earliest known work of Bangla literature?',
        'বাংলা সাহিত্যের প্রাচীনতম নিদর্শন কোনটি?',
      ),
      options: [
        L('Shrikrishnakirtan', 'শ্রীকৃষ্ণকীর্তন'),
        L('Mangalkavya', 'মঙ্গলকাব্য'),
        L('Charyapada', 'চর্যাপদ'),
        L('Vaishnava Padavali', 'বৈষ্ণব পদাবলি'),
      ],
      correct: 2,
      explain: L(
        'Charyapada is the earliest known work of Bangla literature.',
        'চর্যাপদ বাংলা সাহিত্যের প্রাচীনতম নিদর্শন।',
      ),
    },
    {
      prompt: L('Who wrote "Nakshi Kanthar Math"?', '"নকশী কাঁথার মাঠ" কার রচনা?'),
      options: [
        L('Jibanananda Das', 'জীবনানন্দ দাশ'),
        L('Sukanta Bhattacharya', 'সুকান্ত ভট্টাচার্য'),
        L('Shamsur Rahman', 'শামসুর রাহমান'),
        L('Jasimuddin', 'জসীমউদ্দীন'),
      ],
      correct: 3,
      explain: L(
        'Jasimuddin, the "Palli Kabi", wrote Nakshi Kanthar Math.',
        '"পল্লীকবি" জসীমউদ্দীন নকশী কাঁথার মাঠ রচনা করেন।',
      ),
    },
    {
      prompt: L('Who wrote "Meghnad Badh Kavya"?', '"মেঘনাদবধ কাব্য" কার রচনা?'),
      options: [
        L('Michael Madhusudan Dutt', 'মাইকেল মধুসূদন দত্ত'),
        L('Rabindranath Tagore', 'রবীন্দ্রনাথ ঠাকুর'),
        L('Bankim Chandra Chattopadhyay', 'বঙ্কিমচন্দ্র চট্টোপাধ্যায়'),
        L('Ishwar Chandra Vidyasagar', 'ঈশ্বরচন্দ্র বিদ্যাসাগর'),
      ],
      correct: 0,
      explain: L(
        'Michael Madhusudan Dutt wrote it in blank verse (amitrakshar chhanda).',
        'মাইকেল মধুসূদন দত্ত অমিত্রাক্ষর ছন্দে এটি রচনা করেন।',
      ),
    },
  ],
  english: [
    {
      prompt: L('Choose the correct sentence.', 'সঠিক বাক্যটি বাছাই করুন।'),
      options: [
        same('She go to school every day.'),
        same('She goes to school every day.'),
        same('She going to school every day.'),
        same('She gone to school every day.'),
      ],
      correct: 1,
      explain: L(
        'A third-person singular subject takes the -s form in the simple present: "she goes".',
        'Simple present-এ third-person singular subject-এর সাথে verb-এ -s যুক্ত হয়: "she goes"।',
      ),
    },
    {
      prompt: L('What is the past participle of "write"?', '"write"-এর past participle কোনটি?'),
      options: [same('wrote'), same('written'), same('writed'), same('writing')],
      correct: 1,
      explain: L('write – wrote – written.', 'write – wrote – written।'),
    },
    {
      prompt: L('Which word is a noun?', 'কোন শব্দটি noun?'),
      options: [same('quickly'), same('happiness'), same('beautiful'), same('run')],
      correct: 1,
      explain: L(
        '"Happiness" names a thing (a feeling), so it is a noun.',
        '"Happiness" একটি অনুভূতির নাম, তাই এটি noun।',
      ),
    },
    {
      prompt: L(
        'Neither the teacher nor the students ___ present.',
        'Neither the teacher nor the students ___ present.',
      ),
      options: [same('was'), same('were'), same('is'), same('has')],
      correct: 1,
      explain: L(
        'With "neither … nor", the verb agrees with the nearer subject: "students were".',
        '"neither … nor"-এ verb কাছের subject অনুযায়ী হয়: "students were"।',
      ),
    },
    {
      prompt: L('What is the antonym of "ancient"?', '"ancient"-এর বিপরীত শব্দ কোনটি?'),
      options: [same('old'), same('modern'), same('antique'), same('aged')],
      correct: 1,
      explain: L(
        '"Ancient" means very old; its opposite is "modern".',
        '"Ancient" অর্থ অতি প্রাচীন; বিপরীত শব্দ "modern"।',
      ),
    },
  ],
  math: [
    {
      prompt: L('What is 25% of 480?', '৪৮০-এর ২৫% কত?'),
      options: [L('100', '১০০'), L('120', '১২০'), L('140', '১৪০'), L('96', '৯৬')],
      correct: 1,
      explain: L('25% is one quarter: 480 ÷ 4 = 120.', '২৫% মানে এক-চতুর্থাংশ: ৪৮০ ÷ ৪ = ১২০।'),
    },
    {
      prompt: L(
        'A shop buys an item for Tk 800 and sells it for Tk 1,000. What is the profit percentage?',
        'একটি দোকান ৮০০ টাকায় কিনে ১,০০০ টাকায় বিক্রি করে। লাভের হার কত?',
      ),
      options: [L('20%', '২০%'), L('25%', '২৫%'), L('15%', '১৫%'), L('30%', '৩০%')],
      correct: 1,
      explain: L(
        'Profit = 200 on a cost of 800: 200 ÷ 800 × 100 = 25%.',
        'লাভ ২০০, ক্রয়মূল্য ৮০০: ২০০ ÷ ৮০০ × ১০০ = ২৫%।',
      ),
    },
    {
      prompt: L('If 3x + 5 = 20, what is x?', '৩x + ৫ = ২০ হলে x-এর মান কত?'),
      options: [L('3', '৩'), L('4', '৪'), L('5', '৫'), L('6', '৬')],
      correct: 2,
      explain: L('3x = 15, so x = 5.', '৩x = ১৫, তাই x = ৫।'),
    },
    {
      prompt: L('What is the average of 4, 8, 12 and 16?', '৪, ৮, ১২ ও ১৬-এর গড় কত?'),
      options: [L('8', '৮'), L('10', '১০'), L('12', '১২'), L('9', '৯')],
      correct: 1,
      explain: L(
        'The sum is 40 and there are 4 numbers: 40 ÷ 4 = 10.',
        'যোগফল ৪০, সংখ্যা ৪টি: ৪০ ÷ ৪ = ১০।',
      ),
    },
    {
      prompt: L(
        'What is the simple interest on Tk 5,000 at 10% a year for 2 years?',
        '৫,০০০ টাকার বার্ষিক ১০% হারে ২ বছরের সরল মুনাফা কত?',
      ),
      options: [
        L('Tk 500', '৫০০ টাকা'),
        L('Tk 1,000', '১,০০০ টাকা'),
        L('Tk 1,100', '১,১০০ টাকা'),
        L('Tk 1,050', '১,০৫০ টাকা'),
      ],
      correct: 1,
      explain: L(
        'Interest = principal × rate × time = 5,000 × 0.10 × 2 = 1,000.',
        'মুনাফা = আসল × হার × সময় = ৫,০০০ × ০.১০ × ২ = ১,০০০।',
      ),
    },
  ],
  physics: [
    {
      prompt: L('What is the SI unit of force?', 'বলের SI একক কী?'),
      options: [L('Joule', 'জুল'), L('Newton', 'নিউটন'), L('Watt', 'ওয়াট'), L('Pascal', 'প্যাসকেল')],
      correct: 1,
      explain: L(
        'Force is measured in newtons (N); 1 N = 1 kg·m/s².',
        'বলের একক নিউটন (N); ১ N = ১ kg·m/s²।',
      ),
    },
    {
      prompt: L(
        "Newton's first law of motion is also called the law of:",
        'নিউটনের গতির প্রথম সূত্রকে আর কী বলা হয়?',
      ),
      options: [
        L('inertia', 'জড়তা'),
        L('acceleration', 'ত্বরণ'),
        L('gravitation', 'মহাকর্ষ'),
        L('reaction', 'প্রতিক্রিয়া'),
      ],
      correct: 0,
      explain: L(
        'An object stays at rest or in uniform motion unless a net force acts on it: the law of inertia.',
        'নিট বল না লাগলে বস্তু স্থির বা সমবেগে থাকে: একে জড়তার সূত্র বলে।',
      ),
    },
    {
      prompt: L(
        'About how large is the acceleration due to gravity at the Earth’s surface?',
        'পৃথিবীপৃষ্ঠে অভিকর্ষজ ত্বরণ প্রায় কত?',
      ),
      options: [
        L('6.7 m/s²', '৬.৭ m/s²'),
        L('8.9 m/s²', '৮.৯ m/s²'),
        L('9.8 m/s²', '৯.৮ m/s²'),
        L('10.8 m/s²', '১০.৮ m/s²'),
      ],
      correct: 2,
      explain: L('g is about 9.8 m/s² at the Earth’s surface.', 'পৃথিবীপৃষ্ঠে g-এর মান প্রায় ৯.৮ m/s²।'),
    },
    {
      prompt: L(
        'A 2 kg mass accelerates at 3 m/s². What is the net force on it?',
        '২ kg ভরের বস্তুর ত্বরণ ৩ m/s² হলে এর উপর নিট বল কত?',
      ),
      options: [L('5 N', '৫ N'), L('6 N', '৬ N'), L('1.5 N', '১.৫ N'), L('9 N', '৯ N')],
      correct: 1,
      explain: L('F = ma = 2 × 3 = 6 N.', 'F = ma = ২ × ৩ = ৬ N।'),
    },
    {
      prompt: L('Which of these travels fastest?', 'নিচের কোনটি সবচেয়ে দ্রুত চলে?'),
      options: [
        L('Sound in air', 'বাতাসে শব্দ'),
        L('Light in a vacuum', 'শূন্যস্থানে আলো'),
        L('Sound in water', 'পানিতে শব্দ'),
        L('Light in glass', 'কাচে আলো'),
      ],
      correct: 1,
      explain: L(
        'Light in a vacuum travels at about 3 × 10⁸ m/s, the fastest possible speed.',
        'শূন্যস্থানে আলোর বেগ প্রায় ৩ × ১০⁸ m/s, যা সর্বোচ্চ।',
      ),
    },
  ],
  ict: [
    {
      prompt: L('What is decimal 5 in binary?', 'দশমিক ৫-এর বাইনারি রূপ কী?'),
      options: [same('101'), same('110'), same('111'), same('100')],
      correct: 0,
      explain: L(
        '5 = 4 + 1 = 1×2² + 0×2¹ + 1×2⁰, so 101.',
        '৫ = ৪ + ১ = ১×২² + ০×২¹ + ১×২⁰, তাই 101।',
      ),
    },
    {
      prompt: L('What does HTML stand for?', 'HTML-এর পূর্ণরূপ কী?'),
      options: [
        same('HyperText Markup Language'),
        same('HighText Machine Language'),
        same('HyperTool Multi Language'),
        same('HyperText Markdown Language'),
      ],
      correct: 0,
      explain: L(
        'HTML is the HyperText Markup Language used to structure web pages.',
        'HTML হলো HyperText Markup Language, যা দিয়ে ওয়েব পেজের কাঠামো তৈরি হয়।',
      ),
    },
    {
      prompt: L('How many bits are there in one byte?', 'এক বাইটে কয়টি বিট থাকে?'),
      options: [L('4', '৪'), L('8', '৮'), L('16', '১৬'), L('32', '৩২')],
      correct: 1,
      explain: L('One byte is 8 bits.', 'এক বাইট = ৮ বিট।'),
    },
    {
      prompt: L('Which of these is an input device?', 'নিচের কোনটি ইনপুট ডিভাইস?'),
      options: [
        L('Monitor', 'মনিটর'),
        L('Printer', 'প্রিন্টার'),
        L('Keyboard', 'কিবোর্ড'),
        L('Speaker', 'স্পিকার'),
      ],
      correct: 2,
      explain: L(
        'A keyboard sends data into the computer; the others show or play output.',
        'কিবোর্ড কম্পিউটারে তথ্য পাঠায়; বাকিগুলো আউটপুট দেখায় বা শোনায়।',
      ),
    },
    {
      prompt: L('What does CPU stand for?', 'CPU-এর পূর্ণরূপ কী?'),
      options: [
        same('Central Processing Unit'),
        same('Computer Personal Unit'),
        same('Central Program Utility'),
        same('Control Processing Unit'),
      ],
      correct: 0,
      explain: L(
        'The CPU, the Central Processing Unit, carries out the program’s instructions.',
        'CPU বা Central Processing Unit প্রোগ্রামের নির্দেশ পালন করে।',
      ),
    },
  ],
  science: [
    {
      prompt: L(
        'Which part of the cell is called its powerhouse?',
        'কোষের কোন অংশকে শক্তিঘর বলা হয়?',
      ),
      options: [
        L('Nucleus', 'নিউক্লিয়াস'),
        L('Mitochondria', 'মাইটোকন্ড্রিয়া'),
        L('Ribosome', 'রাইবোসোম'),
        L('Chloroplast', 'ক্লোরোপ্লাস্ট'),
      ],
      correct: 1,
      explain: L(
        'Mitochondria release energy from food through cellular respiration.',
        'মাইটোকন্ড্রিয়া কোষীয় শ্বসনের মাধ্যমে খাদ্য থেকে শক্তি উৎপন্ন করে।',
      ),
    },
    {
      prompt: L('How do green plants make their food?', 'সবুজ উদ্ভিদ কীভাবে খাদ্য তৈরি করে?'),
      options: [
        L('Respiration', 'শ্বসন'),
        L('Photosynthesis', 'সালোকসংশ্লেষণ'),
        L('Transpiration', 'প্রস্বেদন'),
        L('Digestion', 'পরিপাক'),
      ],
      correct: 1,
      explain: L(
        'Plants use sunlight, water and carbon dioxide to make glucose: photosynthesis.',
        'উদ্ভিদ সূর্যালোক, পানি ও কার্বন ডাই-অক্সাইড দিয়ে গ্লুকোজ তৈরি করে: সালোকসংশ্লেষণ।',
      ),
    },
    {
      prompt: L(
        'About what is the normal human body temperature?',
        'মানুষের দেহের স্বাভাবিক তাপমাত্রা প্রায় কত?',
      ),
      options: [
        L('37 °C', '৩৭ °সে'),
        L('40 °C', '৪০ °সে'),
        L('35 °C', '৩৫ °সে'),
        L('42 °C', '৪২ °সে'),
      ],
      correct: 0,
      explain: L(
        'Normal body temperature is about 37 °C (98.6 °F).',
        'দেহের স্বাভাবিক তাপমাত্রা প্রায় ৩৭ °সে (৯৮.৬ °ফা)।',
      ),
    },
    {
      prompt: L('What is the chemical formula of water?', 'পানির রাসায়নিক সংকেত কী?'),
      options: [same('H₂O'), same('CO₂'), same('O₂'), same('H₂O₂')],
      correct: 0,
      explain: L(
        'A water molecule has two hydrogen atoms and one oxygen atom: H₂O.',
        'পানির অণুতে দুটি হাইড্রোজেন ও একটি অক্সিজেন পরমাণু থাকে: H₂O।',
      ),
    },
    {
      prompt: L(
        'Which gas do plants take in for photosynthesis?',
        'সালোকসংশ্লেষণের জন্য উদ্ভিদ কোন গ্যাস গ্রহণ করে?',
      ),
      options: [
        L('Oxygen', 'অক্সিজেন'),
        L('Nitrogen', 'নাইট্রোজেন'),
        L('Carbon dioxide', 'কার্বন ডাই-অক্সাইড'),
        L('Hydrogen', 'হাইড্রোজেন'),
      ],
      correct: 2,
      explain: L(
        'Plants take in carbon dioxide and give out oxygen during photosynthesis.',
        'সালোকসংশ্লেষণে উদ্ভিদ কার্বন ডাই-অক্সাইড গ্রহণ করে ও অক্সিজেন ত্যাগ করে।',
      ),
    },
  ],
};

/** Each ID checked against YouTube oEmbed (exists, embeddable). Placeholders for the demo. */
const VIDEOS: Record<Bank, readonly string[]> = {
  physics: ['5-ZFOhHQS68', 'oNgo9bbDi7Q', 'J8mLQQZeIH8', 'rjkQcfw5fkM', '9BJ_WWRgtLc'],
  science: ['oNgo9bbDi7Q', '5-ZFOhHQS68'],
  math: ['FaDtge_vkbg', 'gKywkLHV6Ko'],
  ict: ['FaDtge_vkbg', 'gKywkLHV6Ko'],
  english: ['HWjRVkTNoNM', 'IaslvsYxFVU'],
  gk: ['RGqj9z65P3Y'],
  bangla: ['RGqj9z65P3Y'],
};

const KEYWORDS: Array<[Bank, RegExp]> = [
  ['bangla', /\bbangla\b|literature|grammar and composition/i],
  [
    'english',
    /english|vocabulary|tense|parts of speech|sentence|reading comprehension|written|voice|focus writing/i,
  ],
  ['physics', /physics|motion|force|newton|energy|wave|electric|gravit|vector|mechanics/i],
  ['ict', /\bict\b|computer|html|programming|number system|network|hardware/i],
  ['science', /biology|chemistry|science|medical|cell/i],
  [
    'math',
    /math|arithmetic|algebra|geometry|percent|profit|time and work|data interpretation|statistic|sets|reasoning|ka unit|engineering/i,
  ],
];

function bankFor(...texts: string[]): Bank {
  for (const text of texts) {
    for (const [bank, pattern] of KEYWORDS) if (pattern.test(text)) return bank;
  }
  return 'gk';
}

const text = (t: string) => ({ type: 'text', text: t });
const para = (t: string) => ({ type: 'paragraph', content: [text(t)] });
const heading = (level: 2 | 3, t: string) => ({
  type: 'heading',
  attrs: { level },
  content: [text(t)],
});
const bullets = (items: string[]) => ({
  type: 'bulletList',
  content: items.map((i) => ({ type: 'listItem', content: [para(i)] })),
});

/** A reading built from the bank's checked facts, in one language. */
function readingBody(lang: 'en' | 'bn', section: Lang, course: Lang, bank: Bank) {
  const facts = BANKS[bank].map((q) => q.explain[lang]);
  return lang === 'en'
    ? {
        type: 'doc',
        content: [
          heading(2, `${section.en}: key ideas`),
          para(
            `This reading sums up ${section.en} for ${course.en}. Read it after the video, then try the practice quiz.`,
          ),
          heading(3, 'What to remember'),
          bullets(facts),
          para(
            'Questions you get wrong in the quiz are saved for your Mistake Vault, so you can practise them again.',
          ),
        ],
      }
    : {
        type: 'doc',
        content: [
          heading(2, `${section.bn}: মূল ধারণা`),
          para(
            `এই পাঠে ${course.bn} কোর্সের "${section.bn}" অংশের সারকথা দেওয়া হলো। ভিডিওর পরে পড়ুন, তারপর অনুশীলন কুইজ দিন।`,
          ),
          heading(3, 'যা মনে রাখবেন'),
          bullets(facts),
          para('কুইজে যে প্রশ্ন ভুল হবে, তা আপনার ভুলের ভল্টে জমা থাকবে, যাতে আবার অনুশীলন করতে পারেন।'),
        ],
      };
}

function videoNotes(lang: 'en' | 'bn', section: Lang) {
  return lang === 'en'
    ? {
        type: 'doc',
        content: [
          para(`Watch the lecture on ${section.en}, then open the reading for the key points.`),
        ],
      }
    : {
        type: 'doc',
        content: [para(`"${section.bn}" বিষয়ের লেকচারটি দেখুন, তারপর মূল পয়েন্টগুলোর জন্য পাঠটি খুলুন।`)],
      };
}

const DEMO_BANDS = ['demo_academic', 'demo_jobs'];

/**
 * Gives every demo section a published version with content: a reading body for text lessons,
 * a YouTube ID (and short notes) for video lessons, and 5 MCQs for quiz lessons. Idempotent.
 */
export async function ensureDemoLearningContent(client: pg.Client): Promise<void> {
  const sections = await client.query<{
    section_id: string;
    live_version_id: string;
    title_bn: string;
    title_en: string;
    course_bn: string;
    course_en: string;
  }>(
    `SELECT s.section_id, s.live_version_id, sv.title_bn, sv.title_en, c.title_bn AS course_bn, c.title_en AS course_en
     FROM section s
     JOIN section_version sv ON sv.section_version_id = s.live_version_id
     JOIN course c ON c.course_id = s.course_id
     JOIN goal g ON g.goal_id = c.goal_id
     JOIN goal_segment gs ON gs.segment_id = g.segment_id
     WHERE gs.battle_band = ANY($1::text[])
     ORDER BY c.title_en, s.position`,
    [DEMO_BANDS],
  );
  let refreshed = 0;
  let questionsAdded = 0;
  let videoTurn = 0;
  for (const s of sections.rows) {
    const lessons = await client.query<{
      lesson_id: string;
      kind: 'video' | 'text' | 'quiz';
      position: number;
      title_bn: string | null;
      title_en: string | null;
      body_en: unknown;
      youtube_video_id: string | null;
    }>(
      `SELECT lv.lesson_id, l.kind, lv.position, lv.title_bn, lv.title_en, lv.body_en, lv.youtube_video_id
       FROM lesson_version lv JOIN lesson l ON l.lesson_id = lv.lesson_id
       WHERE lv.section_version_id = $1 ORDER BY lv.position`,
      [s.live_version_id],
    );
    const section = { en: s.title_en, bn: s.title_bn };
    const course = { en: s.course_en, bn: s.course_bn };
    const bank = bankFor(s.title_en, s.course_en);
    const needsContent = lessons.rows.some(
      (l) =>
        (l.kind === 'video' && !l.youtube_video_id) || (l.kind === 'text' && l.body_en === null),
    );

    await client.query('BEGIN');
    try {
      if (needsContent) {
        const next = await client.query<{ n: number }>(
          'SELECT coalesce(max(version_number), 0) + 1 AS n FROM section_version WHERE section_id = $1',
          [s.section_id],
        );
        await client.query(
          `UPDATE section_version SET review_state = 'superseded', superseded_at = now()
           WHERE section_version_id = $1`,
          [s.live_version_id],
        );
        const created = await client.query<{ section_version_id: string }>(
          `INSERT INTO section_version (section_id, version_number, title_bn, title_en, review_state, based_on_version_id, published_at)
           VALUES ($1, $2, $3, $4, 'published', $5, now()) RETURNING section_version_id`,
          [s.section_id, next.rows[0]?.n, s.title_bn, s.title_en, s.live_version_id],
        );
        const versionId = created.rows[0]?.section_version_id;
        for (const l of lessons.rows) {
          const pool = VIDEOS[bank];
          const youtube = l.kind === 'video' ? (pool[videoTurn++ % pool.length] ?? null) : null;
          const bodyEn =
            l.kind === 'text'
              ? readingBody('en', section, course, bank)
              : l.kind === 'video'
                ? videoNotes('en', section)
                : null;
          const bodyBn =
            l.kind === 'text'
              ? readingBody('bn', section, course, bank)
              : l.kind === 'video'
                ? videoNotes('bn', section)
                : null;
          await client.query(
            `INSERT INTO lesson_version (lesson_id, section_version_id, position, title_bn, title_en, body_bn, body_en, youtube_video_id, quiz_question_count, media_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              l.lesson_id,
              versionId,
              l.position,
              l.title_bn,
              l.title_en,
              bodyBn ? JSON.stringify(bodyBn) : null,
              bodyEn ? JSON.stringify(bodyEn) : null,
              youtube,
              l.kind === 'quiz' ? BANKS[bank].length : 0,
              l.kind === 'video' ? 'ready' : 'none',
            ],
          );
        }
        await client.query('UPDATE section SET live_version_id = $2 WHERE section_id = $1', [
          s.section_id,
          versionId,
        ]);
        refreshed += 1;
      }
      for (const l of lessons.rows.filter((x) => x.kind === 'quiz')) {
        const live = await client.query<{ lesson_version_id: string }>(
          `SELECT lv.lesson_version_id FROM lesson_version lv
           JOIN section s ON s.live_version_id = lv.section_version_id
           WHERE lv.lesson_id = $1`,
          [l.lesson_id],
        );
        const liveVersionId = live.rows[0]?.lesson_version_id;
        if (!liveVersionId) continue;
        const has = await client.query(
          'SELECT 1 FROM quiz_question WHERE lesson_version_id = $1 LIMIT 1',
          [liveVersionId],
        );
        if (has.rowCount) continue;
        for (const [i, q] of BANKS[bank].entries()) {
          await client.query(
            `INSERT INTO quiz_question (lesson_id, lesson_version_id, position, prompt_bn, prompt_en, options_bn, options_en, correct_index, explanation_bn, explanation_en)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              l.lesson_id,
              liveVersionId,
              i + 1,
              q.prompt.bn,
              q.prompt.en,
              q.options.map((o) => o.bn),
              q.options.map((o) => o.en),
              q.correct,
              q.explain.bn,
              q.explain.en,
            ],
          );
          questionsAdded += 1;
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  console.log(
    `Demo content: ${refreshed} sections given reading, video and quiz content; ${questionsAdded} quiz questions added.`,
  );
}

const DEMO_PURCHASES = [
  'BCS Preliminary Complete Preparation',
  'Bangladesh Affairs',
  'Mathematical Reasoning',
];

/**
 * The demo Student's purchases, made the way the fake gateway does: a succeeded payment at the
 * course's price and one enrolment per payment. The first course gets its first lessons done.
 */
export async function ensureDemoPurchases(client: pg.Client, userId: string): Promise<void> {
  const owned = await client.query('SELECT 1 FROM enrolment WHERE user_id = $1 LIMIT 1', [userId]);
  if (owned.rowCount) return;
  await client.query('BEGIN');
  try {
    for (const [index, title] of DEMO_PURCHASES.entries()) {
      const course = await client.query<{
        course_id: string;
        list_price_poisha: number;
        access_duration_months: number;
      }>(
        `SELECT c.course_id, c.list_price_poisha, c.access_duration_months
         FROM course c JOIN goal g ON g.goal_id = c.goal_id JOIN goal_segment gs ON gs.segment_id = g.segment_id
         WHERE c.title_en = $1 AND gs.battle_band = ANY($2::text[]) AND c.status = 'published' LIMIT 1`,
        [title, DEMO_BANDS],
      );
      const row = course.rows[0];
      if (!row) continue;
      const pay = await client.query<{ payment_id: string }>(
        `INSERT INTO payment (user_id, course_id, amount_poisha, access_duration_months, gateway, status, gateway_ref, settled_at)
         VALUES ($1, $2, $3, $4, 'fake', 'succeeded', 'fake-demo', now()) RETURNING payment_id`,
        [userId, row.course_id, row.list_price_poisha, row.access_duration_months],
      );
      await client.query(
        `INSERT INTO enrolment (user_id, course_id, payment_id, starts_at, ends_at, status)
         VALUES ($1, $2, $3, now(), now() + make_interval(months => $4), 'active')`,
        [userId, row.course_id, pay.rows[0]?.payment_id, row.access_duration_months],
      );
      if (index === 0) {
        await client.query(
          `INSERT INTO lesson_progress (user_id, lesson_id, course_id)
           SELECT $1, lv.lesson_id, $2
           FROM section s
           JOIN lesson_version lv ON lv.section_version_id = s.live_version_id
           JOIN lesson l ON l.lesson_id = lv.lesson_id AND l.kind <> 'quiz'
           WHERE s.course_id = $2
           ORDER BY s.position, lv.position
           LIMIT 2
           ON CONFLICT DO NOTHING`,
          [userId, row.course_id],
        );
      }
    }
    await client.query('COMMIT');
    console.log(`Demo student purchases: ${DEMO_PURCHASES.join(', ')}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** A demo instructor who can sign in (two-step setup is still required, as for all staff). */
export const DEMO_INSTRUCTOR = {
  email: 'demo.instructor2@example.test',
  password: 'DemoTeacher2026!',
};

/**
 * Gives the demo instructor who leads several demo courses a password and the instructor role, so
 * the course editor (video and quiz authoring) can be tried. Idempotent.
 */
export async function ensureDemoInstructor(
  client: pg.Client,
  hash: (password: string) => Promise<string>,
): Promise<void> {
  const found = await client.query<{ user_id: string }>(
    'SELECT user_id FROM user_account WHERE email_normalised = $1',
    [DEMO_INSTRUCTOR.email],
  );
  const userId = found.rows[0]?.user_id;
  if (!userId) return;
  await client.query(
    `UPDATE user_account SET status = 'active', email_verified = true,
       email_verified_at = coalesce(email_verified_at, now()) WHERE user_id = $1`,
    [userId],
  );
  const role = await client.query(
    `SELECT 1 FROM staff_role_assignment WHERE user_id = $1 AND role = 'instructor' AND revoked_at IS NULL`,
    [userId],
  );
  if (!role.rowCount) {
    await client.query(
      `INSERT INTO staff_role_assignment (user_id, role, instructor_type, assigned_by)
       VALUES ($1, 'instructor', 'employee', $1)`,
      [userId],
    );
  }
  const credential = await client.query(
    `SELECT 1 FROM auth_account WHERE user_id = $1 AND provider_id = 'credential'`,
    [userId],
  );
  if (!credential.rowCount) {
    await client.query(
      `INSERT INTO auth_account (provider_account_id, provider_id, user_id, password_hash)
       VALUES ($1, 'credential', $2, $3)`,
      [userId, userId, await hash(DEMO_INSTRUCTOR.password)],
    );
  }
  console.log(
    `Demo instructor ready (two-step setup on first sign-in): ${DEMO_INSTRUCTOR.email} / ${DEMO_INSTRUCTOR.password}`,
  );
}
