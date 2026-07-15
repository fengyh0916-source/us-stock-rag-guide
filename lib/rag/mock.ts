import type { ChatRequest, ChatResponse, ChatSource } from "@/lib/rag/types";

const SOURCES = {
  hkBank: {
    title: "大陆用户开通港卡必读指南",
    section: "为什么需要香港银行账户",
    url: "/posts/why-hk-bank-account"
  },
  brokerGuide: {
    title: "大陆用户美股券商 101 指南",
    section: "券商选择与开户路径",
    url: "/posts/us-broker-guide"
  },
  ibkr: {
    title: "盈透券商大陆用户开户攻略",
    section: "IBKR 开户准备",
    url: "/posts/ibkr-account"
  },
  wise: {
    title: "Wise 多币种钱包从 0 到 1 教程",
    section: "入金与出金路径",
    url: "/posts/wise-account"
  },
  hkCardSpending: {
    title: "港卡的钱怎么在内地花",
    section: "港币消费与资金使用",
    url: "/posts/hk-card-spending-in-mainland"
  }
} satisfies Record<string, ChatSource>;

const DEFAULT_WARNING = "Mock RAG 演示回答，未连接真实向量库或模型。";
const SAFETY_TEXT = "我不能给出具体买卖建议，但可以帮你理解投资工具、风险和学习路径。";

function includesAny(message: string, terms: string[]) {
  const normalized = message.toLowerCase();

  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function relatedArticles(sources: ChatSource[]) {
  return sources
    .filter((source): source is ChatSource & { url: string } => Boolean(source.url))
    .map((source) => ({
      title: source.title,
      url: source.url,
    }));
}

function response(answer: string, sources: ChatSource[]): ChatResponse {
  return {
    answer,
    warnings: [DEFAULT_WARNING],
    sources,
    relatedArticles: relatedArticles(sources),
    provider: "mock",
  };
}

export function getMockChatResponse(request: ChatRequest): ChatResponse {
  const message = request.message.trim();

  if (includesAny(message, ["推荐", "买哪只", "股票", "明天"])) {
    return response(
      `${SAFETY_TEXT} 如果你刚开始，可以先学习港卡、券商、出入金和 ETF/指数的基础概念，再根据自己的风险承受能力做独立决策。`,
      [SOURCES.brokerGuide]
    );
  }

  if (includesAny(message, ["港卡", "境外银行", "香港银行", "银行卡"])) {
    return response(
      "如果还没有港卡，可以先从香港或跨境银行账户开始：它通常用于承接境外券商入金、管理港币/美元资金，并把资金流转和日常消费分开规划。建议先确认开户资格、所需证件、账户维护成本和后续入金路径，再决定是否线上开户或赴港办理。",
      [SOURCES.hkBank]
    );
  }

  if (includesAny(message, ["券商", "ibkr", "盈透", "interactive brokers", "开户"])) {
    return response(
      "选美股券商时，可以先看三件事：是否支持你的身份开户、入金和换汇路径是否顺畅、费用和产品范围是否适合长期学习。IBKR/盈透适合想接触更完整市场工具的用户，但开户资料、税务表格和资金路径要提前准备；如果只是入门，也可以先对比券商门槛、中文支持和操作复杂度。",
      [SOURCES.brokerGuide, SOURCES.ibkr]
    );
  }

  if (includesAny(message, ["入金", "出金", "wise", "资金", "汇款", "转账"])) {
    return response(
      "出入金可以按“人民币资金来源、港卡或多币种账户、中间换汇/汇款工具、券商账户”这条链路来拆解。常见思路包括港卡转账、Wise 多币种账户辅助管理资金，以及回到内地消费或使用港币的方案。重点是先确认每一步的费用、到账时间、合规要求和失败退回路径。",
      [SOURCES.wise, SOURCES.hkCardSpending]
    );
  }

  if (includesAny(message, ["voo", "标普 500", "标普500", "s&p 500", "etf"])) {
    return response(
      "VOO 是跟踪标普 500 指数的一只 ETF。可以把标普 500 理解为一篮子美国大型公司的指数，VOO 则是让普通投资者通过一个交易品种去获得接近该指数表现的工具。入门时建议先理解指数、ETF、费用率、跟踪误差和长期波动，而不是把它当作短期预测工具。",
      [SOURCES.brokerGuide]
    );
  }

  return response(
    "你可以把美股入门拆成四步：先准备境外银行或港卡，再了解美股券商开户条件，接着规划入金/出金路径，最后学习指数、ETF、风险和税务基础。告诉我你现在卡在哪一步，我可以按站内教程帮你梳理下一步。",
    [SOURCES.hkBank, SOURCES.brokerGuide, SOURCES.wise]
  );
}
