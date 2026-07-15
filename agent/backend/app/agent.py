"""轻量 Agent：意图路由 + 拒答 + 新手引导。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


class Intent(str, Enum):
    KNOWLEDGE = "knowledge"  # 走 RAG
    GUIDE = "guide"  # 新手引导
    CLARIFY = "clarify"  # 问题过宽，先追问
    REFUSE = "refuse"  # 拒答
    CHITCHAT = "chitchat"  # 闲聊拉回


REFUSE_PATTERNS = [
    r"推荐.*(股票|个股|标的|买什么|代码|美股|几只|三只|一只)",
    r"(推荐|安利)\s*\d*\s*只.*(股|美股)",
    r"(买|购)哪(只|支|个).*(股|etf|基金|美股)",
    r"(帮我|给我).*(选股|荐股|抄底|逃顶|推荐.*股)",
    r"会不会涨|能赚多少|保本|稳赚|明天.*涨|涨还是跌",
    r"(怎么|如何).*(逃税|避税|隐瞒|不报税|洗钱)",
    r"伪造|ps.*地址|假.*证明",
    r"代操|代开|内幕",
]

# Discussing why a prohibited/risky behavior is unsafe is legitimate education,
# not a request to perform that behavior.
SAFE_EDUCATION_PATTERNS = [
    r"为什么.*(不应|不能|不要|别).*(稳赚|保本|逃税|伪造|假.*证明)",
    r"(稳赚|保本|逃税|伪造|假.*证明).*(为什么|有何|什么).*(危险|风险|不可信|不能信)",
]

GUIDE_PATTERNS = [
    r"新手|小白|入门|从零|怎么开始|如何开始|第一步",
    r"什么都不懂|完全不懂|刚开始",
    r"适合我吗|我该怎么选|给我.*路线|规划",
    r"完整流程|整体流程|全流程",
]

# 能直接回答的问法：定义、关系、已点明对象和具体环节。
DIRECT_ANSWER_PATTERNS = [
    r".{1,30}(是什么|什么意思|指什么|怎么理解)[\s？?。]*$",
    r".{1,30}(有什么区别|有何区别|区别是什么|什么关系)[\s？?。]*$",
    r"第\s*\d+\s*步|具体步骤|开户教程|流程图",
]

NAMED_ENTITY_PATTERN = (
    r"ZA\s*Bank|众安|嘉信|Schwab|盈透|IBKR|Interactive|Firstrade|长桥|富途|老虎|"
    r"CRS|FATCA|ITIN|QDII|ACH|Wise|汇丰|中银香港|渣打|ETF|VOO|QQQ|SPY|标普"
)

SPECIFIC_PREDICATE_PATTERN = (
    r"怎么|如何|能否|能不能|可以吗|条件|材料|费率|佣金|手续费|多久到账|失败|被拒|"
    r"限额|安全吗|合法吗|风险|税|为什么|注意什么|要注意"
)

# 偏宽、需先澄清
VAGUE_PATTERNS = [
    r"^(怎么|如何).{0,12}(买|炒|投|弄|办|选|开始)",
    r"(怎么办|怎么弄|怎么搞|哪个好|选哪个|有什么建议|该怎么做)",
    r"我想.*(买|炒|投)美股",
    r"我想.*(开户|办港卡|开账户)",
    r"帮我看看|帮帮我|从哪开始|不知从何|不知道怎么",
    r"普通人.*美股|美股.*入门|炒美股",
    r"^(该|要)?怎么(入金|出金|出入金)[\s？?。]*$",
    r"^(有哪些|有什么).{0,8}(券商|开户方式|入金方式|出金方式)",
    r"^(美股|港卡|出入金|开户|券商)[\s？?。!！]*$",
]

MAX_CLARIFY_QUESTIONS = 2

CLARIFICATION_QUESTIONS = {
    "focus": (
        "你现在最想先解决哪一块：A. 开户与账户；B. 资金进出；"
        "C. 税务合规；D. 完整入门路线？"
    ),
    "account_target": (
        "你想先解决哪类账户：A. 港卡或其他境外银行账户；B. 美股券商账户？"
    ),
    "account_status": (
        "你目前已有的账户更接近哪种情况：A. 只有大陆银行卡；"
        "B. 已有港卡或其他境外银行账户；C. 已有美股券商账户？"
    ),
    "broker_stage": (
        "你现在处在哪个阶段：A. 还没开户，正在比较券商；"
        "B. 已选好券商，但卡在开户；C. 已开户，想确认下一步？"
    ),
    "broker_priority": (
        "如果要比较券商，你最在意哪一点：A. 流程省事；B. 成本和费率；"
        "C. 市场与功能覆盖？"
    ),
    "tax_focus": (
        "你最想先了解哪一类：A. 股息预扣税；B. 盈利后的申报；"
        "C. CRS 与境外账户信息交换？"
    ),
}

CLARIFICATION_LABELS = {
    "focus": "关注重点",
    "account_target": "账户目标",
    "account_status": "现有账户情况",
    "broker_stage": "券商使用阶段",
    "broker_priority": "券商选择偏好",
    "tax_focus": "税务关注点",
}

CLARIFICATION_CHOICES = {
    "focus": {
        "A": "开户与账户",
        "B": "资金进出",
        "C": "税务合规",
        "D": "完整入门路线",
    },
    "account_target": {
        "A": "港卡或其他境外银行账户",
        "B": "美股券商账户",
    },
    "account_status": {
        "A": "只有大陆银行卡",
        "B": "已有港卡或其他境外银行账户",
        "C": "已有美股券商账户",
    },
    "broker_stage": {
        "A": "还没开户，正在比较券商",
        "B": "已选好券商，但卡在开户",
        "C": "已开户，想确认下一步",
    },
    "broker_priority": {
        "A": "更在意流程省事",
        "B": "更在意成本和费率",
        "C": "更在意市场与功能覆盖",
    },
    "tax_focus": {
        "A": "股息预扣税",
        "B": "盈利后的申报",
        "C": "CRS 与境外账户信息交换",
    },
}

SKIP_CLARIFICATION_PATTERNS = [
    r"别问|不用问|直接(说|回答|告诉我)|先给我.*答案|按一般情况|跳过",
    r"^(不知道|不清楚|不确定|随便)[\s。！!？?]*$",
]


@dataclass
class ClarificationDecision:
    action: str  # ask / answer / restart
    question: str = ""
    state: Optional[Dict[str, Any]] = None
    effective_question: str = ""
    after_clarify: bool = False

# 上一轮助手是否在追问（用于识别用户正在补充信息）
CLARIFY_MARKERS = [
    "想先确认",
    "先确认一件事",
    "帮我确认",
    "方便的话回一下",
    "如果不想补充",
    "回编号也可以",
    "先问你一两个",
    "先问你一两",
    "问题有点宽",
    "更在意哪一点",
    "更在意什么",
    "你目前的情况更接近",
]

CHITCHAT_PATTERNS = [
    r"^(你好|您好|hi|hello|在吗|嗨)[\s!！。.?？]*$",
    r"你是谁|你叫什么|你能做什么|功能",
    r"谢谢|感谢|再见",
]

# 意图 → 检索标签提示
TAG_HINTS = [
    (r"CRS|FATCA|税务|报税|税|税收", "税务"),
    (r"ITIN|税号", "税务"),
    (r"港卡|香港.*银行|香港账户|美元账户", "港卡"),
    (r"开户|银行账户|券商账户", "开户"),
    (r"券商|IB|盈透|Firstrade|嘉信|Schwab|老虎|富途|BIT", "券商"),
    (r"出入金|入金|汇款|打钱|转账.*券商", "入金"),
    (r"出入金|出金|提现|汇回|拿回来", "出金"),
    (r"加密|USDT|比特币|CARF|Fiat24", "加密"),
    (r"合规|风险|QDII|合法", "合规"),
]


def is_specific_question(message: str) -> bool:
    text = message.strip()
    if any(re.search(p, text, re.I) for p in DIRECT_ANSWER_PATTERNS):
        return True
    if re.search(NAMED_ENTITY_PATTERN, text, re.I) and re.search(
        SPECIFIC_PREDICATE_PATTERN, text, re.I
    ):
        return True
    # 信息充分的长问题通常可以直接检索回答，不应仅因表达开放而追问。
    return len(text) >= 60


def is_vague_question(message: str) -> bool:
    """缺失信息会明显改变回答路径时，才视为需要澄清。"""
    text = message.strip()
    if not text:
        return False
    if is_specific_question(text):
        return False
    if any(re.search(p, text, re.I) for p in VAGUE_PATTERNS):
        return True
    # 只有一个领域名词，没有表达具体问题。
    if len(text) <= 8 and re.fullmatch(
        r"[\s，,。？?！!]*(美股|港卡|券商|开户|入金|出金|出入金|税务|合规)[\s，,。？?！!]*",
        text,
        re.I,
    ):
        return True
    return False


def detect_clarification_topic(message: str) -> str:
    text = message.strip()
    if re.search(r"CRS|FATCA|税务|报税|税收|合规", text, re.I):
        return "tax"
    if re.search(r"出入金|入金|出金|提现|汇款|转账|换汇|资金", text, re.I):
        return "funding"
    if re.search(r"券商|IBKR|盈透|嘉信|Schwab|Firstrade|长桥|富途|老虎", text, re.I):
        return "broker"
    if re.search(r"港卡|香港银行|境外银行|开户|账户", text, re.I):
        return "account"
    if re.search(r"买美股|投美股|炒美股|新手|小白|入门|从零|开始", text, re.I):
        return "beginner"
    return "unknown"


def _first_slot(topic: str, message: str) -> str:
    if topic == "tax":
        return "tax_focus"
    if topic == "funding":
        return "account_status"
    if topic == "broker":
        return "broker_stage"
    if topic == "account":
        # 用户已明确说港卡/境外银行时，不必再问是哪类账户。
        if re.search(r"港卡|香港银行|境外银行", message, re.I):
            return "account_status"
        return "account_target"
    return "focus"


def normalize_clarification_state(raw: Optional[dict]) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    original = str(raw.get("original_question") or "").strip()
    pending_slot = str(raw.get("pending_slot") or "").strip()
    if not original or pending_slot not in CLARIFICATION_QUESTIONS:
        return None
    try:
        asked_count = int(raw.get("asked_count") or 0)
    except (TypeError, ValueError):
        asked_count = 0
    collected_raw = raw.get("collected")
    collected: Dict[str, str] = {}
    if isinstance(collected_raw, dict):
        for key, value in collected_raw.items():
            if key in CLARIFICATION_QUESTIONS and isinstance(value, str) and value.strip():
                collected[key] = value.strip()[:300]
    topic = str(raw.get("topic") or detect_clarification_topic(original))
    if topic not in {"tax", "funding", "broker", "account", "beginner", "unknown"}:
        topic = "unknown"
    return {
        "original_question": original[:2000],
        "topic": topic,
        "asked_count": max(0, min(MAX_CLARIFY_QUESTIONS, asked_count)),
        "pending_slot": pending_slot,
        "collected": collected,
    }


def _canonicalize_answer(slot: str, message: str) -> str:
    text = message.strip()
    choice = re.match(r"^\s*([A-Da-dＡ-Ｄａ-ｄ])(?:\s*$|[\s.、,，:：）)])", text)
    if choice:
        key = choice.group(1).upper()
        key = chr(ord(key) - 0xFEE0) if "Ａ" <= key <= "Ｄ" else key
        mapped = CLARIFICATION_CHOICES.get(slot, {}).get(key)
        if mapped:
            return mapped
    return text[:300]


def _topic_from_focus(answer: str) -> str:
    if re.search(r"税|CRS|合规", answer, re.I):
        return "tax"
    if re.search(r"资金|入金|出金|汇款|换汇", answer, re.I):
        return "funding"
    if re.search(r"券商", answer, re.I):
        return "broker"
    if re.search(r"开户|账户|港卡|银行", answer, re.I):
        return "account"
    return "beginner"


def _next_slot(state: Dict[str, Any], answered_slot: str, answer: str) -> Optional[str]:
    if state["asked_count"] >= MAX_CLARIFY_QUESTIONS:
        return None
    if answered_slot == "focus":
        state["topic"] = _topic_from_focus(answer)
        if state["topic"] == "tax":
            return None
        if state["topic"] == "account" and answer == "开户与账户":
            return "account_target"
        if state["topic"] == "broker":
            return "broker_stage"
        return "account_status"
    if answered_slot == "account_target":
        return "account_status"
    if answered_slot == "broker_stage" and re.search(r"比较|还没开户", answer):
        return "broker_priority"
    return None


def _wants_to_skip_clarification(message: str) -> bool:
    return any(re.search(p, message.strip(), re.I) for p in SKIP_CLARIFICATION_PATTERNS)


def _looks_like_new_question(message: str) -> bool:
    text = message.strip()
    if re.search(r"^(换个问题|另外问|我再问|不说这个)", text):
        return True
    return bool(re.search(r"[？?]\s*$", text) and len(text) >= 6 and is_specific_question(text))


def build_effective_question(state: Dict[str, Any], *, skipped: bool = False) -> str:
    parts = [state["original_question"]]
    details = []
    for slot, answer in state.get("collected", {}).items():
        label = CLARIFICATION_LABELS.get(slot, slot)
        details.append(f"{label}：{answer}")
    if details:
        parts.append("用户补充：" + "；".join(details))
    if skipped:
        parts.append("用户希望按一般情况直接说明，未知条件请明确假设")
    return "；".join(parts)


def start_clarification(message: str) -> ClarificationDecision:
    topic = detect_clarification_topic(message)
    slot = _first_slot(topic, message)
    state = {
        "original_question": message.strip(),
        "topic": topic,
        "asked_count": 1,
        "pending_slot": slot,
        "collected": {},
    }
    return ClarificationDecision(
        action="ask",
        question=CLARIFICATION_QUESTIONS[slot],
        state=state,
    )


def continue_clarification(message: str, raw_state: Optional[dict]) -> ClarificationDecision:
    state = normalize_clarification_state(raw_state)
    if state is None:
        return ClarificationDecision(action="restart", effective_question=message.strip())
    if _looks_like_new_question(message):
        return ClarificationDecision(action="restart", effective_question=message.strip())
    if _wants_to_skip_clarification(message):
        return ClarificationDecision(
            action="answer",
            effective_question=build_effective_question(state, skipped=True),
            after_clarify=True,
        )

    answered_slot = state["pending_slot"]
    answer = _canonicalize_answer(answered_slot, message)
    state["collected"][answered_slot] = answer
    next_slot = _next_slot(state, answered_slot, answer)
    if next_slot and state["asked_count"] < MAX_CLARIFY_QUESTIONS:
        state["asked_count"] += 1
        state["pending_slot"] = next_slot
        return ClarificationDecision(
            action="ask",
            question=CLARIFICATION_QUESTIONS[next_slot],
            state=state,
            after_clarify=True,
        )

    return ClarificationDecision(
        action="answer",
        effective_question=build_effective_question(state),
        after_clarify=True,
    )


def clarification_reply(question: str) -> str:
    return (
        "为了给你更对口的说明，我先确认一件事。回复选项或直接说你的情况都可以。\n\n"
        f"{question}\n\n"
        "如果不想补充，也可以直接回复「直接回答」。\n\n"
        "⚠️ 仅供科普，不构成投资、税务或法律建议。"
    )


def history_has_pending_clarify(history: Optional[List[dict]]) -> bool:
    if not history:
        return False
    for h in reversed(history):
        if h.get("role") != "assistant":
            continue
        content = h.get("content") or ""
        return any(m in content for m in CLARIFY_MARKERS)
    return False


def compose_question_from_history(message: str, history: Optional[List[dict]]) -> str:
    """把澄清前的用户问题 + 本轮补充拼成检索/回答用的综合问题。"""
    user_bits: List[str] = []
    if history:
        for h in history[-6:]:
            if h.get("role") == "user":
                c = (h.get("content") or "").strip()
                if c:
                    user_bits.append(c)
    user_bits.append(message.strip())
    # 去重保序
    seen = set()
    ordered = []
    for b in user_bits:
        if b not in seen:
            seen.add(b)
            ordered.append(b)
    joined = "；".join(ordered)
    return (
        f"用户分多轮说明的情况如下：{joined}。"
        f"请综合这些信息，直接给出完整、可执行的科普解答，不要再追问。"
    )


def classify_intent(message: str, history: Optional[List[dict]] = None) -> Intent:
    text = message.strip()
    if not text:
        return Intent.CHITCHAT

    if any(re.search(pat, text, re.I) for pat in SAFE_EDUCATION_PATTERNS):
        return Intent.KNOWLEDGE

    for pat in REFUSE_PATTERNS:
        if re.search(pat, text, re.I):
            return Intent.REFUSE

    for pat in CHITCHAT_PATTERNS:
        if re.search(pat, text, re.I):
            return Intent.CHITCHAT

    # 上一轮在澄清：本轮当补充信息，走知识回答
    if history_has_pending_clarify(history):
        return Intent.KNOWLEDGE

    # 明确的定义、关系或具体对象问题，即使带有「新手」等词也应直接回答。
    if is_specific_question(text):
        return Intent.KNOWLEDGE

    for pat in GUIDE_PATTERNS:
        if re.search(pat, text, re.I):
            return Intent.GUIDE

    if is_vague_question(text):
        return Intent.CLARIFY

    return Intent.KNOWLEDGE


def guess_tag(message: str) -> Optional[str]:
    for pat, tag in TAG_HINTS:
        if re.search(pat, message, re.I):
            return tag
    return None


def refuse_reply() -> str:
    return (
        "这个我没法按「荐股 / 教你规避监管」的方式回答。\n\n"
        "我更适合帮你搞清楚这些事，例如：\n"
        "· 想买美股，大概要准备哪些账户\n"
        "· 钱怎么转进去、以后怎么拿回来\n"
        "· 券商大致有什么差别、税务上要注意什么\n\n"
        "你可以换一个科普向的问题，或点下方快捷问题。若涉及具体投资、报税决策，请咨询专业人士。\n\n"
        "⚠️ 本服务仅供科普学习，不构成投资、税务或法律建议。"
    )


def chitchat_reply(message: str) -> str:
    if re.search(r"谢谢|感谢", message):
        return "不客气。还想了解开户、转钱、选券商或税务注意点，随时问我。"
    return (
        "你好，我是美股投资扫盲助手。\n\n"
        "如果你是第一次接触美股，或已经听说过但不知道怎么买，可以问我例如：\n"
        "· 要从头了解的话，该先弄清什么？\n"
        "· 没有境外卡还能不能买？\n"
        "· 开完户钱怎么转进去？\n"
        "· 盈透、嘉信这些有啥不一样？\n"
        "· 赚了钱税务上要注意什么？\n\n"
        "直接输入问题，或点下方快捷问题即可。\n\n"
        "⚠️ 仅供科普，不构成投资、税务或法律建议。政策变化快，请自行核实。"
    )


def guide_questions() -> str:
    decision = start_clarification("我是美股新手，想了解该怎么开始")
    return clarification_reply(decision.question)


def clarify_questions(message: str) -> str:
    """兼容旧调用：只返回第一轮的一个澄清问题。"""
    decision = start_clarification(message)
    return clarification_reply(decision.question)


def guide_from_answers(message: str) -> Tuple[str, bool]:
    """根据用户对引导题的回答，返回是否应继续走 RAG 以及补充说明。"""
    text = message.lower()
    # 若像在答 AB，给结构化路径；否则当普通知识问题
    if re.search(r"[abcａｂｃ]|省事|报税|合规|扫盲|香港|大陆|远程", text, re.I):
        plan = (
            "结合你说的情况，建议按下面顺序了解（先懂规则，再谈动手）：\n\n"
            "一、先搞懂「钱和税」相关常识\n"
            "· CRS 是什么、和境外账户有什么关系\n"
            "· 不同做法大致有什么风险差异（稳妥 vs 更折腾）\n\n"
            "二、弄清要准备哪些账户\n"
            "· 银行侧：美元/境外资金从哪进出（如香港、美国银行等常见路径）\n"
            "· 券商侧：在哪里下单买美股，常见平台各自门槛大致如何\n\n"
            "三、资金怎么进去、以后怎么出来\n"
            "· 入金：开户后钱如何转到可交易状态\n"
            "· 出金：想用、想汇回时常见路径和注意点\n\n"
            "四、有余力再了解\n"
            "· 美国税号（ITIN）可能带来的开户范围变化\n"
            "· 加密等进阶路径（门槛和合规风险更高，多数人不必一上来就碰）\n\n"
            "你可以接着问：\n"
            "「CRS 和我有什么关系」「没有港卡还能买吗」「盈透和嘉信怎么选」「钱怎么转进去」\n\n"
            "⚠️ 仅供科普。动手前请自行核实最新政策与机构要求，重大决策请咨询专业人士。"
        )
        return plan, False  # False = 不必再 RAG（已是完整引导）
    return "", True  # 当知识问答继续
