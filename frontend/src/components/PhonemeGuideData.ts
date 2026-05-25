export interface PhonemeGuide {
  symbol: string; // The symbol code matching Azure Speech API output
  ipaSymbol: string; // Standard IPA display
  name: string; // Human readable category name
  type: "vowel" | "diphthong" | "nasal" | "plosive" | "fricative" | "other";
  voiced: boolean;
  tonguePosition:
    | "high-front"
    | "mid-front"
    | "low-front"
    | "high-back"
    | "mid-back"
    | "low-back"
    | "neutral"
    | "alveolar"
    | "velar"
    | "dental"
    | "diphthong-ey"
    | "diphthong-ay"
    | "diphthong-oy"
    | "diphthong-aw"
    | "diphthong-ow";
  mouthOpening: "closed" | "narrow" | "medium" | "wide";
  velum: "open" | "closed";
  descriptionCn: string;
  descriptionEn: string;
  tongueInstructions: string;
  lipInstructions: string;
  airflowInstructions: string;
  coachTips: string;
  guideWord: string;
  minimalPairs: { word1: string; word2: string; ipa1: string; ipa2: string; note: string }[];
  practiceWords: string[];
}

const SHORT_E_GUIDE: PhonemeGuide = {
  symbol: "ɛ",
  ipaSymbol: "ɛ",
  name: "Short Front Vowel (短前元音)",
  type: "vowel",
  voiced: true,
  tonguePosition: "mid-front",
  mouthOpening: "medium",
  velum: "closed",
  descriptionCn: "短前元音。嘴巴保持半开，舌前部抬到中位，声音短促稳定，不要向 /ɪ/ 滑动。它像 men, pen, get 里的元音。",
  descriptionEn: "A short front vowel. Keep the mouth moderately open and the front of the tongue at mid height. The sound is short and steady, without gliding toward /ɪ/.",
  tongueInstructions: "舌尖轻抵下齿，舌前部抬起但不要继续向上滑。保持一个稳定位置后快速结束。",
  lipInstructions: "双唇自然放松，口角略微展开。不要像 /eɪ/ 那样随着结尾继续收窄。",
  airflowInstructions: "软腭上升关闭鼻腔，声带震动，气流从口腔平稳送出。",
  coachTips: "如果 men 被说成 main，通常是你在结尾加了向 /ɪ/ 的滑动。练 men 时故意把元音收短、收稳；练 main 时再加上清晰滑动。",
  guideWord: "men",
  minimalPairs: [
    { word1: "men", word2: "main", ipa1: "mɛn", ipa2: "meɪn", note: "Short steady /ɛ/ vs gliding /eɪ/" },
    { word1: "pen", word2: "pain", ipa1: "pɛn", ipa2: "peɪn", note: "Stop the vowel early in 'pen'; glide upward in 'pain'" },
    { word1: "get", word2: "gate", ipa1: "gɛt", ipa2: "geɪt", note: "Keep 'get' short; let 'gate' move toward /ɪ/" },
    { word1: "let", word2: "late", ipa1: "lɛt", ipa2: "leɪt", note: "Do not let 'let' turn into a diphthong" },
  ],
  practiceWords: ["men", "pen", "get", "let", "said", "red", "bed", "ten"],
};

const RHOTIC_VOWEL_GUIDE: PhonemeGuide = {
  symbol: "ɝ",
  ipaSymbol: "ɝ",
  name: "R-colored Vowel (卷舌元音)",
  type: "vowel",
  voiced: true,
  tonguePosition: "neutral",
  mouthOpening: "narrow",
  velum: "closed",
  descriptionCn: "卷舌元音。先保持中央元音的口腔空间，再让舌身向后收，舌尖或舌面前部微微抬起但不要碰到上腭。",
  descriptionEn: "An r-colored vowel. Keep a central vowel shape, then retract the tongue body and slightly raise the tongue tip/front without touching the roof of the mouth.",
  tongueInstructions: "舌头整体向后收，舌尖悬空，不要像中文卷舌声母那样摩擦上腭。",
  lipInstructions: "双唇轻微收圆或放松，不要过度噘嘴；重点在舌头后收和口腔共鸣。",
  airflowInstructions: "软腭上升，声带震动，气流持续从口腔通过，不能出现擦音或弹舌。",
  coachTips: "girl, work, turn 这类词容易把 /ɝ/ 发成普通元音加中文式 r。保持一个连续的卷舌元音，不要拆成两个声音。",
  guideWord: "girl",
  minimalPairs: [
    { word1: "girl", word2: "go", ipa1: "gɝl", ipa2: "goʊ", note: "Keep the r-colored center in 'girl'" },
    { word1: "work", word2: "walk", ipa1: "wɝk", ipa2: "wɔk", note: "Retract the tongue for 'work'; open more for 'walk'" },
    { word1: "turn", word2: "ten", ipa1: "tɝn", ipa2: "tɛn", note: "Do not flatten 'turn' into a short front vowel" },
  ],
  practiceWords: ["girl", "work", "turn", "word", "learn", "early", "certainly", "her"],
};

export const PHONEME_GUIDES: Record<string, PhonemeGuide> = {
  // --- VOWELS & DIPHTHONGS ---
  "ɛ": SHORT_E_GUIDE,
  e: SHORT_E_GUIDE,
  eh: SHORT_E_GUIDE,
  "ɝ": RHOTIC_VOWEL_GUIDE,
  "ɚ": RHOTIC_VOWEL_GUIDE,
  er: RHOTIC_VOWEL_GUIDE,
  ey: {
    symbol: "ey",
    ipaSymbol: "eɪ",
    name: "Diphthong Vowel (前合双元音)",
    type: "diphthong",
    voiced: true,
    tonguePosition: "diphthong-ey",
    mouthOpening: "medium",
    velum: "closed",
    descriptionCn: "双元音。发音时先发 /e/ 音（类似于 bed 中的元音，口形半开，舌尖抵下齿），然后下颌自然收起，舌头向 /ɪ/ 的方向（类似于 pin 中的短音，舌位高而靠前）平滑移动。整个音程中发音是连续滑动的，音量前重后轻。",
    descriptionEn: "A diphthong vowel. Start with the mouth moderately open and the tongue in the mid-front position (as in 'bed'). Smoothly slide the jaw upwards and forward toward the /ɪ/ position (as in 'pin'), narrowing the mouth opening and fading out at the end.",
    tongueInstructions: "舌尖轻抵下齿。发音开始时舌前部抬高至中位，随后舌头顺畅地向前方和上方滑行抬起。",
    lipInstructions: "双唇略微扁平呈微笑状，发音过程中随着下颌合起而更加紧缩扁平。",
    airflowInstructions: "软腭上升堵住鼻腔通道，声带剧烈震动，气流由口腔顺畅呼出。",
    coachTips: "最常见的错误是发成类似 men (短 /e/) 的单音节音，导致 main 听起来像 men。一定要做出滑动，让发音有一个向 /ɪ/ 滑动的饱满尾音！",
    guideWord: "day",
    minimalPairs: [
      { word1: "main", word2: "men", ipa1: "meɪn", ipa2: "mɛn", note: "Contrast diphthong /eɪ/ with short monophthong /ɛ/" },
      { word1: "pain", word2: "pen", ipa1: "peɪn", ipa2: "pɛn", note: "Hear the vowel sliding upward in 'pain'" },
      { word1: "gate", word2: "get", ipa1: "geɪt", ipa2: "gɛt", note: "Double check you are not shortening the vowel in 'gate'" },
      { word1: "late", word2: "let", ipa1: "leɪt", ipa2: "lɛt", note: "Keep the vowel in 'late' prolonged and gliding" },
    ],
    practiceWords: ["main", "pain", "day", "face", "rain", "gate", "cake", "make"],
  },
  "eɪ": {
    // Alias mapping to support direct lookups in both systems
    symbol: "eɪ",
    ipaSymbol: "eɪ",
    name: "Diphthong Vowel (前合双元音)",
    type: "diphthong",
    voiced: true,
    tonguePosition: "diphthong-ey",
    mouthOpening: "medium",
    velum: "closed",
    descriptionCn: "双元音。发音时先发 /e/ 音（类似于 bed 中的元音，口形半开，舌尖抵下齿），然后下颌自然收起，舌头向 /ɪ/ 的方向（类似于 pin 中的短音，舌位高而靠前）平滑移动。整个音程中发音是连续滑动的，音量前重后轻。",
    descriptionEn: "A diphthong vowel. Start with the mouth moderately open and the tongue in the mid-front position (as in 'bed'). Smoothly slide the jaw upwards and forward toward the /ɪ/ position (as in 'pin'), narrowing the mouth opening and fading out at the end.",
    tongueInstructions: "舌尖轻抵下齿。发音开始时舌前部抬高至中位，随后舌头顺畅地向前方和上方滑行抬起。",
    lipInstructions: "双唇略微扁平呈微笑状，发音过程中随着下颌合起而更加紧缩扁平。",
    airflowInstructions: "软腭上升堵住鼻腔通道，声带剧烈震动，气流由口腔顺畅呼出。",
    coachTips: "最常见的错误是发成类似 men (短 /e/) 的单音节音，导致 main 听起来像 men。一定要做出滑动，让发音有一个向 /ɪ/ 滑动的饱满尾音！",
    guideWord: "day",
    minimalPairs: [
      { word1: "main", word2: "men", ipa1: "meɪn", ipa2: "mɛn", note: "Contrast diphthong /eɪ/ with short monophthong /ɛ/" },
      { word1: "pain", word2: "pen", ipa1: "peɪn", ipa2: "pɛn", note: "Hear the vowel sliding upward in 'pain'" },
      { word1: "gate", word2: "get", ipa1: "geɪt", ipa2: "gɛt", note: "Double check you are not shortening the vowel in 'gate'" },
      { word1: "late", word2: "let", ipa1: "leɪt", ipa2: "lɛt", note: "Keep the vowel in 'late' prolonged and gliding" },
    ],
    practiceWords: ["main", "pain", "day", "face", "rain", "gate", "cake", "make"],
  },
  // --- NASAL CONSONANTS ---
  m: {
    symbol: "m",
    ipaSymbol: "m",
    name: "Bilabial Nasal Consonant (双唇鼻音)",
    type: "nasal",
    voiced: true,
    tonguePosition: "neutral",
    mouthOpening: "closed",
    velum: "open",
    descriptionCn: "双唇闭合鼻音。双唇自然紧闭，舌头处于自然放松的中央位置。软腭下垂，使鼻腔通道彻底敞开。声带震动，气流受闭合的双唇阻碍，完全从鼻腔送出发出翁鸣音。",
    descriptionEn: "A bilabial nasal consonant. Place your lips completely together, keeping them soft and closed. Relax your tongue in the center of your mouth. Lower your velum (soft palate) to open the nasal passage. Vibrate your vocal cords and let the sound resonate through your nose.",
    tongueInstructions: "舌头完全平放放松，处于不与任何口腔软组织接触的自然状态。",
    lipInstructions: "双唇完全闭紧贴合，阻断口腔气流排出，直到音素发音结束释出。",
    airflowInstructions: "声带震动产生基音，软腭降低，将气流完全分流至鼻腔流出。",
    coachTips: "作为字头音时极易掌握，但作为词尾音时（如 team），有些人双唇没有彻底紧闭，而发成了类似 'n' 的音。确保词尾有明显的‘闭嘴’哼鸣声！",
    guideWord: "man",
    minimalPairs: [
      { word1: "team", word2: "teen", ipa1: "tiːm", ipa2: "tiːn", note: "Verify lips are fully closed at the end of 'team' and open for 'teen'" },
      { word1: "seem", word2: "seen", ipa1: "siːm", ipa2: "siːn", note: "Keep your lips closed at the end of 'seem'" },
    ],
    practiceWords: ["main", "man", "my", "more", "make", "team", "some", "game"],
  },
  n: {
    symbol: "n",
    ipaSymbol: "n",
    name: "Alveolar Nasal Consonant (齿龈鼻音)",
    type: "nasal",
    voiced: true,
    tonguePosition: "alveolar",
    mouthOpening: "narrow",
    velum: "open",
    descriptionCn: "齿龈鼻音。双唇微开，舌尖抵住上齿龈（即上排门牙后侧硬邦邦的黏膜突起处），彻底封堵住口腔通道。软腭下垂，气流在声带震动的同时，被迫全部流向鼻腔逸出。",
    descriptionEn: "An alveolar nasal consonant. Slightly open your mouth and press the tip of your tongue firmly against the alveolar ridge (the hard bump behind your front teeth) to block air from leaving the mouth. Lower the velum, vibrate your vocal cords, and let the air escape through your nose.",
    tongueInstructions: "舌尖及舌侧边缘必须紧紧贴住上齿龈，形成半圆弧形的密闭屏障，确保没有任何气流漏入嘴唇处。",
    lipInstructions: "上下双唇微张（不要闭拢），牙齿轻轻拉开，露出阻碍气流的舌头前部。",
    airflowInstructions: "声带剧烈震动，软腭和悬雍垂下沉，让全部气流沿气管进入鼻腔由鼻孔送出。",
    coachTips: "在 main 这一类的词尾发音中，非英语母语者非常容易提前中断发音，或者没有将舌尖顶住上齿龈，导致鼻辅音彻底丢失，变成单纯的元音鼻化。记住，词尾必须稳稳地顶住上齿龈，给单词一个明确的 /n/ 收尾！",
    guideWord: "now",
    minimalPairs: [
      { word1: "main", word2: "may", ipa1: "meɪn", ipa2: "meɪ", note: "Contrast the nasal /n/ ending with the pure open vowel ending" },
      { word1: "line", word2: "lie", ipa1: "laɪn", ipa2: "laɪ", note: "Ensure your tongue clicks up to block the mouth at the end of 'line'" },
      { word1: "pin", word2: "ping", ipa1: "pɪn", ipa2: "pɪŋ", note: "Keep the tongue tip on the alveolar ridge, do not retract it to the throat" },
    ],
    practiceWords: ["main", "now", "no", "new", "nice", "on", "man", "sun", "fine", "ten"],
  },
  // --- OTHER COMMONLY DIFFICULT PHONEMES ---
  ng: {
    symbol: "ng",
    ipaSymbol: "ŋ",
    name: "Velar Nasal Consonant (软腭鼻音)",
    type: "nasal",
    voiced: true,
    tonguePosition: "velar",
    mouthOpening: "narrow",
    velum: "open",
    descriptionCn: "软腭鼻音。嘴唇张开，舌尖平放放松，舌后部（舌根）高高抬起，紧贴住软腭（口腔后顶部的软肉），封锁口腔通道。软腭自然垂下，声带颤动，气流由鼻孔流出。",
    descriptionEn: "A velar nasal consonant. Open your mouth slightly. Raise the back of your tongue to press firmly against the velum (soft palate) at the back of your mouth, blocking the oral passage. Lower the velum, vibrate your vocal cords, and let air flow through your nose.",
    tongueInstructions: "舌尖在下齿下方放松。舌头后部隆起贴靠上腭后部黏膜，彻底封死喉咙与口腔的连线。",
    lipInstructions: "双唇自然分开，保持中立状态，露出气流受阻的舌体。",
    airflowInstructions: "声带震动，阻断口部通路，气流改道自鼻腔后部逸出，产生低沉的鼻音。",
    coachTips: "千万不要把 sing 读成 sin！/ŋ/ (ng) 是舌后部顶住上腭，而 /n/ 是舌尖顶住前齿龈。另外也不要在尾音里发出了一个多余的 /g/（嘎）声。",
    guideWord: "sing",
    minimalPairs: [
      { word1: "sing", word2: "sin", ipa1: "sɪŋ", ipa2: "sɪn", note: "Back of tongue touch for 'sing' vs tongue tip touch for 'sin'" },
      { word1: "thing", word2: "thin", ipa1: "θɪŋ", ipa2: "θɪn", note: "Feel the pressure shift from back (throat) to front (teeth) at the end" },
    ],
    practiceWords: ["sing", "singing", "song", "long", "king", "ring", "bring", "young"],
  },
  "ŋ": {
    symbol: "ŋ",
    ipaSymbol: "ŋ",
    name: "Velar Nasal Consonant (软腭鼻音)",
    type: "nasal",
    voiced: true,
    tonguePosition: "velar",
    mouthOpening: "narrow",
    velum: "open",
    descriptionCn: "软腭鼻音。嘴唇张开，舌尖平放放松，舌后部（舌根）高高抬起，紧贴住软腭（口腔后顶部的软肉），封锁口腔通道。软腭自然垂下，声带颤动，气流由鼻孔流出。",
    descriptionEn: "A velar nasal consonant. Open your mouth slightly. Raise the back of your tongue to press firmly against the velum (soft palate) at the back of your mouth, blocking the oral passage. Lower the velum, vibrate your vocal cords, and let air flow through your nose.",
    tongueInstructions: "舌尖在下齿下方放松。舌头后部隆起贴靠上腭后部黏膜，彻底封死喉咙与口腔的连线。",
    lipInstructions: "双唇自然分开，保持中立状态，露出气流受阻的舌体。",
    airflowInstructions: "声带震动，阻断口部通路，气流改道自鼻腔后部逸出，产生低沉的鼻音。",
    coachTips: "千万不要把 sing 读成 sin！/ŋ/ (ng) 是舌后部顶住上腭，而 /n/ 是舌尖顶住前齿龈。另外也不要在尾音里发出了一个多余的 /g/（嘎）声。",
    guideWord: "sing",
    minimalPairs: [
      { word1: "sing", word2: "sin", ipa1: "sɪŋ", ipa2: "sɪn", note: "Back of tongue touch for 'sing' vs tongue tip touch for 'sin'" },
      { word1: "thing", word2: "thin", ipa1: "θɪŋ", ipa2: "θɪn", note: "Feel the pressure shift from back (throat) to front (teeth) at the end" },
    ],
    practiceWords: ["sing", "singing", "song", "long", "king", "ring", "bring", "young"],
  },
  th: {
    symbol: "th",
    ipaSymbol: "θ",
    name: "Voiceless Dental Fricative (清齿擦音)",
    type: "fricative",
    voiced: false,
    tonguePosition: "dental",
    mouthOpening: "narrow",
    velum: "closed",
    descriptionCn: "清齿擦音（咬舌音）。双唇微开，舌尖平伸，轻轻放在上下齿之间（轻轻咬住舌尖）。软腭抬起封堵鼻腔。发音时用力向外吹气，让气流从舌头和上齿之间的极窄缝隙中摩擦挤出。声带不震动。",
    descriptionEn: "A voiceless dental fricative. Slightly open your mouth and stick the tip of your tongue out between your upper and lower teeth (gently bite it). Raise your velum to close the nose. Blow air out forcefully, letting it squeeze through the narrow gap between your tongue tip and upper teeth. Do not vibrate your vocal cords.",
    tongueInstructions: "舌尖前伸并稍微扁平，使其正好处于上下门齿的咬合缝隙之间，但不可以咬得过死，要留出气流通道。",
    lipInstructions: "嘴唇放松拉平，完全敞开门牙区域，露出咬住的舌尖。",
    airflowInstructions: "气流经过舌头顶端的微小阻碍发生剧烈摩擦产生呼呼气流。声带保持静止，不产生颤动。",
    coachTips: "最普遍的错误是把它发成类似 's' (sit) 或 'f' (fit) 的音。例如 thin 读成了 sin 或 fin。记得一定要把舌尖伸出来咬住！这需要夸张的练习！",
    guideWord: "thin",
    minimalPairs: [
      { word1: "thin", word2: "sin", ipa1: "θɪn", ipa2: "sɪn", note: "Put your tongue between your teeth for 'thin'; keep it inside for 'sin'" },
      { word1: "three", word2: "free", ipa1: "θriː", ipa2: "friː", note: "Use tongue-teeth for 'three'; use lower lip-teeth for 'free'" },
    ],
    practiceWords: ["thin", "thank", "think", "thought", "theme", "path", "both", "mouth", "earth"],
  },
  "θ": {
    symbol: "θ",
    ipaSymbol: "θ",
    name: "Voiceless Dental Fricative (清齿擦音)",
    type: "fricative",
    voiced: false,
    tonguePosition: "dental",
    mouthOpening: "narrow",
    velum: "closed",
    descriptionCn: "清齿擦音（咬舌音）。双唇微开，舌尖平伸，轻轻放在上下齿之间（轻轻咬住舌尖）。软腭抬起封堵鼻腔。发音时用力向外吹气，让气流从舌头和上齿之间的极窄缝隙中摩擦挤出。声带不震动。",
    descriptionEn: "A voiceless dental fricative. Slightly open your mouth and stick the tip of your tongue out between your upper and lower teeth (gently bite it). Raise your velum to close the nose. Blow air out forcefully, letting it squeeze through the narrow gap between your tongue tip and upper teeth. Do not vibrate your vocal cords.",
    tongueInstructions: "舌尖前伸并稍微扁平，使其正好处于上下门齿的咬合缝隙之间，但不可以咬得过死，要留出气流通道。",
    lipInstructions: "嘴唇放松拉平，完全敞开门牙区域，露出咬住的舌尖。",
    airflowInstructions: "气流经过舌头顶端的微小阻碍发生剧烈摩擦产生呼呼气流。声带保持静止，不产生颤动。",
    coachTips: "最普遍的错误是把它发成类似 's' (sit) 或 'f' (fit) 的音。例如 thin 读成了 sin 或 fin。记得一定要把舌尖伸出来咬住！这需要夸张的练习！",
    guideWord: "thin",
    minimalPairs: [
      { word1: "thin", word2: "sin", ipa1: "θɪn", ipa2: "sɪn", note: "Put your tongue between your teeth for 'thin'; keep it inside for 'sin'" },
      { word1: "three", word2: "free", ipa1: "θriː", ipa2: "friː", note: "Use tongue-teeth for 'three'; use lower lip-teeth for 'free'" },
    ],
    practiceWords: ["thin", "thank", "think", "thought", "theme", "path", "both", "mouth", "earth"],
  },
  dh: {
    symbol: "dh",
    ipaSymbol: "ð",
    name: "Voiced Dental Fricative (浊齿擦音)",
    type: "fricative",
    voiced: true,
    tonguePosition: "dental",
    mouthOpening: "narrow",
    velum: "closed",
    descriptionCn: "浊齿擦音（浊咬舌音）。双唇微开，舌尖平伸，轻轻放在上下门齿之间（轻轻咬住舌尖）。软腭抬起封堵鼻腔。发音时声带剧烈震动，同时让气流从舌面与上门牙齿缝间摩擦挤出。",
    descriptionEn: "A voiced dental fricative. Slightly open your mouth and place the tip of your tongue out between your upper and lower teeth (gently bite it). Raise the velum. Vibrate your vocal cords and let the voiced sound squeeze through the gap.",
    tongueInstructions: "舌面展平，舌尖极度放松伸出，搭在上下牙齿中间，保持轻微接触。",
    lipInstructions: "唇角对称微展，保持上下齿露露，使伸出的舌头处于清晰可见状态。",
    airflowInstructions: "声带震动产生底音，气流同时在齿缝间受挤压释放。声带必须保持全程抖动震鸣。",
    coachTips: "最常见的错误是发成 'd' (do) 或者 'z' (zoo)。例如 this 被读成 dis 或 zis。发音时要有震颤感，不要立刻把舌头缩回去！",
    guideWord: "this",
    minimalPairs: [
      { word1: "they", word2: "day", ipa1: "ðeɪ", ipa2: "deɪ", note: "Bite your tongue for 'they'; tap the roof of your mouth for 'day'" },
      { word1: "then", word2: "den", ipa1: "ðen", ipa2: "den", note: "Feel the smooth vibration on the teeth for 'then' vs a quick drop for 'den'" },
    ],
    practiceWords: ["this", "that", "they", "them", "then", "there", "father", "mother", "brother", "with"],
  },
  "ð": {
    symbol: "ð",
    ipaSymbol: "ð",
    name: "Voiced Dental Fricative (浊齿擦音)",
    type: "fricative",
    voiced: true,
    tonguePosition: "dental",
    mouthOpening: "narrow",
    velum: "closed",
    descriptionCn: "浊齿擦音（浊咬舌音）。双唇微开，舌尖平伸，轻轻放在上下门齿之间（轻轻咬住舌尖）。软腭抬起封堵鼻腔。发音时声带剧烈震动，同时让气流从舌面与上门牙齿缝间摩擦挤出。",
    descriptionEn: "A voiced dental fricative. Slightly open your mouth and place the tip of your tongue out between your upper and lower teeth (gently bite it). Raise the velum. Vibrate your vocal cords and let the voiced sound squeeze through the gap.",
    tongueInstructions: "舌面展平，舌尖极度放松伸出，搭在上下牙齿中间，保持轻微接触。",
    lipInstructions: "唇角对称微展，保持上下齿露露，使伸出的舌头处于清晰可见状态。",
    airflowInstructions: "声带震动产生底音，气流同时在齿缝间受挤压释放。声带必须保持全程抖动震鸣。",
    coachTips: "最常见的错误是发成 'd' (do) 或者 'z' (zoo)。例如 this 被读成 dis 或 zis。发音时要有震颤感，不要立刻把舌头缩回去！",
    guideWord: "this",
    minimalPairs: [
      { word1: "they", word2: "day", ipa1: "ðeɪ", ipa2: "deɪ", note: "Bite your tongue for 'they'; tap the roof of your mouth for 'day'" },
      { word1: "then", word2: "den", ipa1: "ðen", ipa2: "den", note: "Feel the smooth vibration on the teeth for 'then' vs a quick drop for 'den'" },
    ],
    practiceWords: ["this", "that", "they", "them", "then", "there", "father", "mother", "brother", "with"],
  },
  // --- HIGH VOWELS ---
  i: {
    symbol: "i",
    ipaSymbol: "iː",
    name: "High Front Vowel (前高长元音)",
    type: "vowel",
    voiced: true,
    tonguePosition: "high-front",
    mouthOpening: "narrow",
    velum: "closed",
    descriptionCn: "长元音（衣）。双唇向两旁扁平拉开（微笑嘴型），牙齿几乎靠拢。舌头前部向上腭前部抬起，高度仅次于半元音 /j/。舌尖轻抵下齿。声带震动，发音饱满而悠长。",
    descriptionEn: "A high front vowel. Pull the corners of your lips far back into a wide smile, with your teeth very close together. Raise the front of your tongue very high toward the roof of your mouth, close to the front teeth. Vibrate your vocal cords and make a long, stable sound.",
    tongueInstructions: "舌尖牢牢顶住下门牙内侧。舌面前端明显弓起，极度靠近上腭，舌两侧缘紧贴上臼齿内侧。",
    lipInstructions: "双唇强烈地向两侧扁平伸展，形成极具爆发力的极客微笑嘴角线，绝不放松。",
    airflowInstructions: "声带强烈振动，口腔形成极其狭长紧绷的发音通道，气流从中均匀流过。",
    coachTips: "注意区分长 /iː/ (see) 和短 /ɪ/ (sit)。/iː/ 的舌头更加紧绷、更高，嘴唇咧得更开，发音较长。千万别读成短音！",
    guideWord: "see",
    minimalPairs: [
      { word1: "feet", word2: "fit", ipa1: "fiːt", ipa2: "fɪt", note: "Tense your mouth for 'feet' (smile!) and relax it for 'fit'" },
      { word1: "seat", word2: "sit", ipa1: "siːt", ipa2: "sɪt", note: "Prolong the vowel in 'seat' vs keep it short and lax in 'sit'" },
    ],
    practiceWords: ["see", "she", "he", "we", "me", "keep", "feet", "quiet", "streets", "week"],
  },
  "iː": {
    symbol: "iː",
    ipaSymbol: "iː",
    name: "High Front Vowel (前高长元音)",
    type: "vowel",
    voiced: true,
    tonguePosition: "high-front",
    mouthOpening: "narrow",
    velum: "closed",
    descriptionCn: "长元音（衣）。双唇向两旁扁平拉开（微笑嘴型），牙齿几乎靠拢。舌头前部向上腭前部抬起，高度仅次于半元音 /j/。舌尖轻抵下齿。声带震动，发音饱满而悠长。",
    descriptionEn: "A high front vowel. Pull the corners of your lips far back into a wide smile, with your teeth very close together. Raise the front of your tongue very high toward the roof of your mouth, close to the front teeth. Vibrate your vocal cords and make a long, stable sound.",
    tongueInstructions: "舌尖牢牢顶住下门牙内侧。舌面前端明显弓起，极度靠近上腭，舌两侧缘紧贴上臼齿内侧。",
    lipInstructions: "双唇强烈地向两侧扁平伸展，形成极具爆发力的极客微笑嘴角线，绝不放松。",
    airflowInstructions: "声带强烈振动，口腔形成极其狭长紧绷的发音通道，气流从中均匀流过。",
    coachTips: "注意区分长 /iː/ (see) 和短 /ɪ/ (sit)。/iː/ 的舌头更加紧绷、更高，嘴唇咧得更开，发音较长。千万别读成短音！",
    guideWord: "see",
    minimalPairs: [
      { word1: "feet", word2: "fit", ipa1: "fiːt", ipa2: "fɪt", note: "Tense your mouth for 'feet' (smile!) and relax it for 'fit'" },
      { word1: "seat", word2: "sit", ipa1: "siːt", ipa2: "sɪt", note: "Prolong the vowel in 'seat' vs keep it short and lax in 'sit'" },
    ],
    practiceWords: ["see", "she", "he", "we", "me", "keep", "feet", "quiet", "streets", "week"],
  },
  r: {
    symbol: "r",
    ipaSymbol: "r",
    name: "Alveolar Approximant Consonant (齿龈无擦通音)",
    type: "other",
    voiced: true,
    tonguePosition: "neutral", // will customize in rendering
    mouthOpening: "narrow",
    velum: "closed",
    descriptionCn: "齿龈无擦通音（卷舌音）。双唇稍扁且向外微翘（类似吹哨嘴型）。舌尖高抬朝向上齿龈后方（硬腭前部），舌身两侧收缩，使舌体略成凹槽。发音时气流从舌面凹槽与硬腭之间顺畅流出，舌尖绝对不可以接触口腔任何部位，且不能抖动！声带震动。",
    descriptionEn: "An alveolar approximant (English R). Round your lips slightly and push them out a bit. Curl the tip of your tongue back, pointing it toward the roof of your mouth (just behind the alveolar ridge). Make sure the tongue tip is floating and DOES NOT touch the roof or shake. Vibrate your vocal cords.",
    tongueInstructions: "舌头卷起，舌尖高悬并向内微缩，悬浮在口腔中部。绝对不能碰到牙齿或上腭！",
    lipInstructions: "双唇突出呈圆筒状或微扁小圆，增加口腔共鸣管的长度，创造出典型的 R 声。",
    airflowInstructions: "气流从隆起的舌两侧和悬空舌尖间的空间平稳送出，声带稳定震动。",
    coachTips: "非母语者容易把英语 /r/ 发成中文的“日”音（舌尖摩擦明显，带有辅音色彩），或者发成舌尖颤音（打滚）。确保舌尖悬空不动，完全没有多余的杂音和物理接触！",
    guideWord: "red",
    minimalPairs: [
      { word1: "red", word2: "led", ipa1: "red", ipa2: "led", note: "Curl your tongue back for 'red'; press the tip to your alveolar ridge for 'led'" },
      { word1: "right", word2: "light", ipa1: "raɪt", ipa2: "laɪt", note: "Floating tongue tip for 'right' vs physical touch-down for 'light'" },
    ],
    practiceWords: ["red", "rain", "right", "run", "room", "try", "street", "quiet", "write", "agree"],
  },
  l: {
    symbol: "l",
    ipaSymbol: "l",
    name: "Alveolar Lateral Consonant (齿龈边音)",
    type: "other",
    voiced: true,
    tonguePosition: "alveolar",
    mouthOpening: "narrow",
    velum: "closed",
    descriptionCn: "齿龈边音。发音时嘴微张，舌尖抵住上齿龈，封锁正前方的气流通道。声带震动，气流被迫从舌头身体两侧（边缘）分流而出，听起来十分清亮柔和。可分为字头清晰音 (Light L) 与字尾含混暗音 (Dark L)。",
    descriptionEn: "An alveolar lateral consonant. Slightly open your mouth. Press the tip of your tongue firmly against the alveolar ridge (the hard bump behind your upper teeth) to block front airflow. Vibrate your vocal cords and let the air flow smoothly over the sides (laterals) of your tongue.",
    tongueInstructions: "舌尖前端紧顶上齿龈。舌体肌肉平铺拉紧，两侧与磨牙拉开缝隙作为声音排放口。",
    lipInstructions: "双唇中性微张，嘴角微向上提，让两侧导流出的音波顺利散开。",
    airflowInstructions: "声带震动，气流由喉咙呼出后分为左、右两股，顺着磨牙和舌侧皮肤缝隙摩擦溢出。",
    coachTips: "在字尾（如 well, school）中，它叫做 Dark L。很多人会把它完全读成 'w' 或 'o' 音，例如 school 读成 /skuːo/。发 Dark L 时虽然舌尖不一定非要完全顶住上齿龈，但舌后部必须隆起，发出含糊的边音共鸣！",
    guideWord: "leg",
    minimalPairs: [
      { word1: "late", word2: "rate", ipa1: "leɪt", ipa2: "reɪt", note: "Press tongue for 'late' vs curl and float tongue for 'rate'" },
      { word1: "light", word2: "right", ipa1: "laɪt", ipa2: "raɪt", note: "Physical seal at alveolar ridge for 'light' vs suspended hover for 'right'" },
    ],
    practiceWords: ["leg", "light", "late", "look", "love", "walk", "plan", "quietly", "school", "well"],
  },
  z: {
    symbol: "z",
    ipaSymbol: "z",
    name: "Voiced Alveolar Fricative Consonant (齿龈浊擦音)",
    type: "fricative",
    voiced: true,
    tonguePosition: "alveolar",
    mouthOpening: "narrow",
    velum: "closed",
    descriptionCn: "齿龈浊擦音（摩擦音）。发音时双唇微张（呈微笑状），上下齿几乎靠拢但留微缝。舌尖抬起，极度靠近上齿龈，形成一条极窄的缝隙。声带剧烈震动，气流从舌尖与齿龈间的窄缝中挤出，发生剧烈摩擦，发出类似蜜蜂嗡嗡叫的摩擦音。",
    descriptionEn: "A voiced alveolar fricative. Slightly open your mouth in a gentle smile, bringing your teeth close together. Raise your tongue tip very close to the alveolar ridge (just behind your upper teeth) to form a narrow gap. Vibrate your vocal cords and squeeze air through this gap to produce a buzzing friction sound.",
    tongueInstructions: "舌尖向齿龈抬起但绝不能碰到它，两侧边缘贴住上臼齿，在舌中线形成狭窄的出气气道。",
    lipInstructions: "双唇向两侧自然拉开呈扁平状，类似微笑，露出牙齿。",
    airflowInstructions: "声带剧烈震动，气流由喉咙呼出，被迫通过舌尖形成的极窄沟槽，冲击门牙缝产生‘滋滋’磨擦声。",
    coachTips: "最常见的错误是舌尖碰到了齿龈，发成了 'd' 或 'j' 的爆破音（例如 zip 读成 dip）；或者声带没有震动，发成了清擦音 's' (zip 读成 sip)。发音时摸摸喉咙，确保声带有明显的麻木嗡鸣感！",
    guideWord: "zoo",
    minimalPairs: [
      { word1: "zip", word2: "sip", ipa1: "zɪp", ipa2: "sɪp", note: "Contrast voiced /z/ with voiceless /s/" },
      { word1: "buzz", word2: "bus", ipa1: "bʌz", ipa2: "bʌs", note: "Keep vocal cords vibrating until the very end of 'buzz'" },
    ],
    practiceWords: ["zoo", "zone", "zero", "buzz", "easy", "busy", "size", "please", "phrase"],
  },
  s: {
    symbol: "s",
    ipaSymbol: "s",
    name: "Voiceless Alveolar Fricative Consonant (齿龈清擦音)",
    type: "fricative",
    voiced: false,
    tonguePosition: "alveolar",
    mouthOpening: "narrow",
    velum: "closed",
    descriptionCn: "齿龈清擦音（嘶嘶音）。嘴唇扁平展开微露牙齿，上下齿极度靠拢但微拉开。舌尖高抬，靠近但不接触上齿龈，形成狭长的出气窄道。软腭抬起封闭鼻腔。发音时声带不震动，强气流从舌尖窄缝通道吹出，在门牙处发生嘶嘶擦音。",
    descriptionEn: "A voiceless alveolar fricative. Keep your lips spread in a smile and bring your teeth very close together. Raise the tip of your tongue near the alveolar ridge without touching it. Blow air out forcefully through this narrow channel, letting it hiss against your teeth. Do not vibrate your vocal cords.",
    tongueInstructions: "舌尖平指前方，极度接近门牙后侧的齿龈但不能触碰，使气流在此产生剧烈摩擦。",
    lipInstructions: "双唇呈扁平微展微笑状，上下门齿咬合微张，使空气容易喷射在齿面上。",
    airflowInstructions: "气流快速自喉部冲出，在口腔前段受窄缝挤压阻碍。声带必须保持完全放松静止。",
    coachTips: "如果发音时舌头伸出门牙外侧，会变成咬舌音 /θ/（清 thin）。舌尖必须乖乖留在门牙内侧！",
    guideWord: "sit",
    minimalPairs: [
      { word1: "sip", word2: "zip", ipa1: "sɪp", ipa2: "zɪp", note: "No vocal vibration for 'sip' vs buzzing vibration for 'zip'" },
      { word1: "sing", word2: "thing", ipa1: "sɪŋ", ipa2: "θɪŋ", note: "Keep your tongue inside for 'sing'; bite your tongue tip for 'thing'" },
    ],
    practiceWords: ["sit", "sing", "some", "see", "sun", "nice", "streets", "face", "place", "class"],
  },
};

PHONEME_GUIDES["ɹ"] = PHONEME_GUIDES.r;

export function getFallbackGuide(symbol: string): PhonemeGuide {
  const cleanSymbol = symbol.trim().toLowerCase();
  
  // Smarter categorizer traits
  const isNasal = ["m", "n", "ng", "ŋ"].some(char => cleanSymbol.includes(char));
  const isFricative = ["s", "z", "f", "v", "sh", "ʃ", "zh", "ʒ", "h", "th", "θ", "dh", "ð"].some(char => cleanSymbol === char);
  const isPlosive = ["p", "b", "t", "d", "k", "g"].some(char => cleanSymbol === char);
  
  // Voiced state detection
  const isVoiceless = ["p", "t", "k", "f", "s", "sh", "ch", "th", "θ", "tʃ", "ʃ"].some(char => cleanSymbol === char);
  const voiced = !isVoiceless;

  let type: PhonemeGuide["type"] = "vowel";
  let tonguePosition: PhonemeGuide["tonguePosition"] = "neutral";
  let mouthOpening: PhonemeGuide["mouthOpening"] = "medium";
  let velum: PhonemeGuide["velum"] = "closed";

  if (isNasal) {
    type = "nasal";
    velum = "open";
    if (cleanSymbol === "m") {
      tonguePosition = "neutral";
      mouthOpening = "closed";
    } else if (cleanSymbol === "n") {
      tonguePosition = "alveolar";
      mouthOpening = "narrow";
    } else {
      tonguePosition = "velar";
      mouthOpening = "narrow";
    }
  } else if (isFricative) {
    type = "fricative";
    mouthOpening = "narrow";
    if (["s", "z"].includes(cleanSymbol)) {
      tonguePosition = "alveolar";
    } else if (["th", "θ", "dh", "ð"].includes(cleanSymbol)) {
      tonguePosition = "dental";
    } else {
      tonguePosition = "neutral";
    }
  } else if (isPlosive) {
    type = "plosive";
    if (["p", "b"].includes(cleanSymbol)) {
      tonguePosition = "neutral";
      mouthOpening = "closed";
    } else if (["t", "d"].includes(cleanSymbol)) {
      tonguePosition = "alveolar";
      mouthOpening = "narrow";
    } else {
      tonguePosition = "velar";
      mouthOpening = "narrow";
    }
  } else {
    // Check if it's a known diphthong alias
    const isDiphthong = ["ey", "eɪ", "ay", "aɪ", "oy", "ɔɪ", "aw", "aʊ", "ow", "əʊ", "oʊ", "ow", "ɪə", "ihr", "eə", "ehr", "ʊə", "uhr"].includes(cleanSymbol);
    if (isDiphthong) {
      type = "diphthong";
      tonguePosition = cleanSymbol.includes("ey") || cleanSymbol.includes("eɪ") ? "diphthong-ey" : "diphthong-ay";
    }
  }

  const cleanName = type === "nasal" ? "Nasal Consonant (鼻音)"
                  : type === "fricative" ? "Fricative Consonant (擦音)"
                  : type === "plosive" ? "Plosive Consonant (爆破音)"
                  : type === "diphthong" ? "Diphthong Vowel (双元音)"
                  : "Vowel (单元音)";

  return {
    symbol,
    ipaSymbol: symbol,
    name: `${cleanName} /${symbol}/`,
    type,
    voiced,
    tonguePosition,
    mouthOpening,
    velum,
    descriptionCn: `音素 /${symbol}/ 详细练习指南正在收录中。你可以直接收听标准发音，并对照底部的词汇或在主界面进行反复对比练习。`,
    descriptionEn: `Pronunciation details for sound /${symbol}/ are being compiled. You can listen to standard audio models directly and practice along in the workspace.`,
    tongueInstructions: tonguePosition === "alveolar" ? "舌尖轻轻抵住上门牙后的齿龈阻挡或收窄气流。"
                      : tonguePosition === "velar" ? "舌后部（舌根）抬起，贴住上腭后部的软腭封闭通道。"
                      : tonguePosition === "dental" ? "舌尖轻轻伸出放置于上下齿之间（轻咬舌尖）。"
                      : "舌头保持自然状态，或根据音节连读平滑调整。",
    lipInstructions: mouthOpening === "closed" ? "双唇完全闭合贴拢，封阻腔体。"
                   : mouthOpening === "narrow" ? "双唇略微展开呈微笑扁平状，露出上下排牙齿。"
                   : "双唇自然拉开呈放松的椭圆状。",
    airflowInstructions: velum === "open" ? "软腭自然下垂，气流被迫从口腔后部改道从鼻腔流出。"
                       : type === "plosive" ? "气流在口腔闭合处蓄积，随后突发释出产生爆破声。"
                       : "气流从口腔均匀呼出，声带随清浊音分类相应震动或静止。",
    coachTips: `在练习含有 /${symbol}/ 的词汇时，点击发音键反复模仿标准音频，观察其在词中与周围字母的连读衔接！`,
    guideWord: symbol,
    minimalPairs: [],
    practiceWords: [symbol],
  };
}
