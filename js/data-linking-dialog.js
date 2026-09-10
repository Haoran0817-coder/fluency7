/* 连读实验室 · 整段对话连读
   每条对话是真实连续语流，逐句带中文与音变 tip。
   字段：title 标题 / scene 场景 / lines[{en, zh, tip}] */
window.LK_DIALOGS = [
  {
    title: "在咖啡店点单", scene: "日常",
    lines: [
      { en: "Hi, what can I get for you?", zh: "嗨，要点点什么？", tip: "what can I → wha-de-ki 连读；for you 弱读成 f'r ya" },
      { en: "I'll have a medium latte, please.", zh: "我要一杯中杯拿铁。", tip: "I'll have → I'llav 缩读；a medium 中音弱读" },
      { en: "Do you want it for here or to go?", zh: "在这喝还是带走？", tip: "want it → wanna-dit；for here or 快速连读" },
      { en: "To go, thanks. And could I get some sugar?", zh: "带走，谢谢。再给我点糖？", tip: "could I get → 同化；some sugar 的 sugar 弱读" },
      { en: "Sure, that'll be four fifty.", zh: "好的，四块五。", tip: "that'll be → that-uh-be；four fifty 连读成 four-difty" },
      { en: "Can I pay with my card?", zh: "能刷卡吗？", tip: "Can I → 连读；with my 弱读成 with-muh" }
    ]
  },
  {
    title: "朋友闲聊周末", scene: "日常",
    lines: [
      { en: "Are you gonna do anything this weekend?", zh: "这周末你有安排吗？", tip: "gonna=dictionary→口语；this weekend 连读" },
      { en: "Not much. I might just chill at home.", zh: "没啥，可能就宅家。", tip: "might just → 连读；at home 弱读" },
      { en: "Wanna grab a bite later?", zh: "晚点去吃点东西？", tip: "Wanna=want to 缩读；grab a bite 连读" },
      { en: "Sure, let's meet around seven.", zh: "行，七点左右见。", tip: "let's meet → 连读；around seven 弱读" },
      { en: "Sounds good. I'll text you the spot.", zh: "好啊，地点我发你。", tip: "Sounds good 连读；I'll text → I'llax" },
      { en: "Awesome, see ya then!", zh: "太好了，到时见！", tip: "see ya = see you 弱读；then 弱读" }
    ]
  },
  {
    title: "电话约时间", scene: "职场/日常",
    lines: [
      { en: "Hey, is this a good time to talk?", zh: "嘿，现在方便说话吗？", tip: "is this → 连读；to talk 弱读" },
      { en: "Kind of. What's up?", zh: "还行，怎么了？", tip: "Kind of → kinda 缩读" },
      { en: "I wanted to check on our meeting tomorrow.", zh: "想确认下明天开会的事。", tip: "wanted to → wanna；our meeting 连读" },
      { en: "Oh, it's still on for ten, right?", zh: "哦，还是十点对吧？", tip: "it's still → 连读；for ten 弱读" },
      { en: "Yep, don't be late!", zh: "对，别迟到！", tip: "don't be → 连读且 t 失爆" },
      { en: "I won't, see you then.", zh: "不会的，到时见。", tip: "won't 弱读；see you → see ya" }
    ]
  },
  {
    title: "看房", scene: "生活",
    lines: [
      { en: "So this is the living room.", zh: "这是客厅。", tip: "this is → 连读成 theez" },
      { en: "It's pretty spacious, isn't it?", zh: "挺宽敞的，是吧？", tip: "isn't it → 弱读连读；pretty 弱读" },
      { en: "Yeah, and the rent's pretty reasonable.", zh: "对，租金也合理。", tip: "rent's → 连读；pretty reasonable 弱读" },
      { en: "Does it come with parking?", zh: "带车位吗？", tip: "Does it → 连读；with parking 弱读" },
      { en: "Yep, there's a spot out back.", zh: "有，后面有个位。", tip: "there's a → 连读" },
      { en: "Great, I'll think it over.", zh: "太好了，我考虑下。", tip: "I'll think → 连读；it over 弱读" }
    ]
  }
];
