import os, json, urllib.request
T=os.environ['GHOST_GIFT_BOT_TOKEN']
def call(m, d):
    r=urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{T}/{m}", json.dumps(d).encode(), {'Content-Type':'application/json'}))
    print(m, d.get('language_code','-'), json.load(r)['ok'])
cmds={
 None:[("start","Открыть Ghost Gift 👻"),("me","Мой профиль: уровень, серия, баланс"),("ref","Пригласить друга (+10%)"),("help","Как это работает")],
 'en':[("start","Open Ghost Gift 👻"),("me","My profile: level, streak, balance"),("ref","Invite a friend (+10%)"),("help","How it works")],
 'uk':[("start","Відкрити Ghost Gift 👻"),("me","Мій профіль: рівень, серія, баланс"),("ref","Запросити друга (+10%)"),("help","Як це працює")],
}
desc={
 None:("👻 Ghost Gift — неоновые кейсы с подарками Telegram, Premium и NFT, колесо, слоты и ежедневная карта удачи.\n\nПрозрачные шансы и проверяемая честность (provably fair). Уровни, серия входов, задания и награды за друзей.\n\nНажми «Играть», чтобы начать.",
       "👻 Кейсы с подарками, Premium и NFT, колесо, слоты и карта удачи"),
 'en':("👻 Ghost Gift — neon cases with Telegram gifts, Premium and NFTs, a wheel, slots and a daily luck card.\n\nTransparent odds and provably fair results. Levels, login streak, quests and rewards for inviting friends.\n\nTap “Play” to start.",
       "👻 Cases with gifts, Premium & NFTs, wheel, slots and a daily luck card"),
 'uk':("👻 Ghost Gift — неонові кейси з подарунками Telegram, Premium і NFT, колесо, слоти та щоденна карта удачі.\n\nПрозорі шанси та перевірна чесність (provably fair). Рівні, серія входів, завдання та нагороди за друзів.\n\nНатисни «Грати», щоб почати.",
       "👻 Кейси з подарунками, Premium і NFT, колесо, слоти й карта удачі"),
}
for lc,c in cmds.items():
    d={"commands":[{"command":a,"description":b} for a,b in c]}
    if lc: d["language_code"]=lc
    call("setMyCommands", d)
for lc,(l,s) in desc.items():
    d={"description":l}; s2={"short_description":s}
    if lc: d["language_code"]=lc; s2["language_code"]=lc
    call("setMyDescription", d); call("setMyShortDescription", s2)
