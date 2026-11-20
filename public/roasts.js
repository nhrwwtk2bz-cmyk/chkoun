/* ============================================================================
   ROAST LINES for the winner spotlight ("Chkoun akther we7ed?" reveal).
   EDIT FREELY: each line is one string. Keep the quotes and the comma at the end.
   Placeholders you can use inside a line:
     {name}  = the winner's name        {n} = votes he got        {total} = all votes
   ============================================================================ */
const ROASTS = {
  // 1) COUNT LINE, shown first. Chosen by how many friends voted for him.
  unanimous: [ // everybody voted for him
    'Kol el groupe vota 3lik! {total} men {total} 😳',
    '{total} men {total}… ma 3andek 7ata mohami ⚖️',
    'Ijma3 total 3lik ya {name}! Rabbi m3ak 😭',
  ],
  majority: [ // 60% of the votes or more
    '{n} men s7abek vota 3lik 😏',
    '{n} men {total} 9alou: houwa heka 🎯',
    '{n} votaw 3lik, w el baa9i sakkta 3al 7a9i9a 👀',
  ],
  few: [ // less than 60%
    'Ghir {n} vote… ama kfew bech tji el awel 😅',
    '{n} men {total} bark, ghir 9ar3a w tla3t enta 🎲',
    'Ma3lech, {n} vote bark ama 7a9ou 7a9ou 🤷',
  ],

  // 2) ROAST LINE, shown after the count line. A random one of these:
  general: [
    'S7abek ya3rfouk a7sen men rou7ek 🔍',
    'Mabrouk! El 3ar rassmi 🎖️',
    'Hedhi mouch propagande, hedhi 7a9i9a 📢',
    'El 7a9 mor… ama el groupe ma7ebch ykedheb 😂',
    'Ma3andekch 3adhr, el groupe 9al kelmtou 🗣️',
    'Dhahar el 7a9 w el 9a3da kemla chahdet 🔥',
    'Ya sidi, 5dhi el vote b chraf w bsa7tek 👑',
  ],

  // ...or one that matches the category of the question (2 out of 3 times)
  cat: {
    chaos: [
      'El fodhi mta3 el groupe rassmi 🌪️',
      'Win ma temchi, el drama temchi m3ak 🎬',
    ],
    friends: [
      'El groupe ya3refek mliz… w mazel y7ebbek 🫶',
      'Kol groupe y7eb ykoun 3andou we7ed kifek 😂',
    ],
    love: [
      '9albek ykhdem akther men el CNSS 💘',
      'El 7ob y3adbek w enta tjri warah 😏',
    ],
    money: [
      'Flousek ma3andhomch 9arar, ymchiw w yjiw 💸',
      'El flous ydhallou yjriw 9odamek, w enta tjri 9odamhom 😂',
    ],
    school: [
      'El prof ya3refek mel nhar loula 📚',
      'Fi examen wala fi 7ayet, dima nafs el 7keya 🎓',
    ],
    savage: [
      'Savage men ghir ma yhess 😈',
      'Ma7ad 9ader y9olou la, 3andou lisen 🔥',
    ],
    tounsi: [
      'Tounsi 100%, w 7ata el 7ouma 3rafetou 🇹🇳',
      'Mol el 7ouma rassmi, fel 7keya w fel 9a3da 🇹🇳',
    ],
    travel: [
      'Safar m3ah ya3ni drama w souvenirs 🧳',
      'El GPS yetlef 9odemou w houwa yetbasem ✈️',
    ],
    job: [
      'El patron y3ayet lih 9bal ma yfi9 💼',
      '3andou 5edma… ama el 9a3da a7la 😅',
    ],
    food: [
      'Yekel akther men el 9a3da kemla 🍕',
      'El mekla f ay blasa, houwa awel wa7ed 🥘',
    ],
    style: [
      'El mraya t9olou "enta" w houwa yesda9 💅',
      'Lebset khir men el kol… wala houwa yaz3am 😎',
    ],
  },

  // 3) When several people tie, a random one of these replaces the roast line:
  tie: [
    'Ta3adol 7a9i9i, kol we7ed 3andou 7a9 😈',
    'El groupe ma9derch yekhtar bin el 3ar w el 3ar 😂',
    'Ma7ad 9ader ysabbek wa7dek, tla3tou jma3a 🔥',
  ],
};

if (typeof module !== 'undefined') module.exports = ROASTS; // lets the tests read this file
