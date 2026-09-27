import json

P = {o['passage_id']: o for o in json.load(open('/Users/goshua/next-order/.tmp/pjy2-l23-shard1-passages.json'))}
ID1, ID2, ID3 = '6a6f570be087c2fe78de5ec9', '6a6f570be087c2fe78de5eca', '6a6f570be087c2fe78de5ecb'
CIRC = '①②③④⑤'
ORDER_OPTS = '① (A) - (C) - (B) ### ② (B) - (A) - (C) ### ③ (B) - (C) - (A) ### ④ (C) - (A) - (B) ### ⑤ (C) - (B) - (A)'
# answer -> labels assigned to (P1, P2, P3) in original order
LABELS = {'①': 'ACB', '②': 'BAC', '③': 'BCA', '④': 'CAB', '⑤': 'CBA'}
Q_ORDER = '주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?'
Q_INS = '글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오.'


def S(pid):
    return P[pid]['content']['sentences_en']


def order_item(pid, given_end, cuts, ans, expl):
    """given = s[0..given_end]; chunks = s[given_end+1..cuts[0]], s[cuts[0]+1..cuts[1]], s[cuts[1]+1..end]"""
    s = S(pid)
    given = ' '.join(s[0:given_end + 1])
    b = [given_end + 1, cuts[0] + 1, cuts[1] + 1, len(s)]
    chunks = [' '.join(s[b[i]:b[i + 1]]) for i in range(3)]
    lab = LABELS[ans]
    by_label = {lab[i]: chunks[i] for i in range(3)}
    para = given + '\n\n' + '\n\n'.join(f'({L}) {by_label[L]}' for L in 'ABC')
    return mk(pid, '순서', Q_ORDER, para, ORDER_OPTS, ans, expl)


def insert_item(pid, remove, first_marker_before, ans, expl):
    """remove sentence index `remove`; markers placed before 5 consecutive remaining sentences
    starting with remaining sentence index `first_marker_before` (None marker = end)."""
    s = S(pid)
    rem = [i for i in range(len(s)) if i != remove]
    start = rem.index(first_marker_before)
    marker_pos = rem[start:start + 5]  # sentence indices that get a marker before them
    parts = []
    m = 0
    for idx in rem:
        if m < 5 and m < len(marker_pos) and idx == marker_pos[m]:
            parts.append(CIRC[m])
            m += 1
        parts.append(s[idx])
    while m < 5:  # end markers
        parts.append(CIRC[m])
        m += 1
    body = ' '.join(parts)
    para = s[remove] + '\n\n' + body
    return mk(pid, '삽입', Q_INS, para, '① ### ② ### ③ ### ④ ### ⑤', ans, expl)


def mk(pid, typ, q, para, opts, ans, expl):
    return {
        'passage_id': pid, 'textbook': '영어II_YBM박준언', 'source': P[pid]['source_key'],
        'type': typ, 'status': '대기', 'option_type': 'English',
        'question_data': {'NumQuestion': 1, 'Source': '', 'Category': '', 'Question': q,
                          'Paragraph': para, 'Options': opts, 'OptionType': 'English',
                          'CorrectAnswer': ans, 'Explanation': expl},
    }


E = {}
E['1o1'] = "②가 정답입니다. 주어진 글은 지윤이 아침에 스마트폰으로 음악 스트리밍 서비스에 접속하며 하루를 시작하는 장면이다. (B)의 'She enjoys listening to her favorite music'은 그 스트리밍 서비스로 음악을 즐기는 모습을 이어 받고, 'For a healthy breakfast'로 아침 식사까지 서술한다. 그 뒤 (A)의 'After school'이 방과 후 동영상 강의 서비스로 시간을 옮기고 'For example'로 구체 사례를 든다. 마지막 (C)의 'During weekends'가 주말의 가족 스트리밍으로 글을 마무리한다.\n논리 흐름 요약: 아침 음악 감상·식사(B) → 방과 후 강의(A) → 주말 영화(C)."
E['1o2'] = "⑤가 정답입니다. 주어진 글은 지윤이 아침에 음악 스트리밍으로 좋아하는 음악을 듣고 새 아티스트를 탐색하는 내용이다. 하루의 시간 순서상 먼저 (C)의 'For a healthy breakfast'가 아침 식사로 받는 구독 배송을 소개한다. 이어 (B)의 'After school'이 방과 후 동영상 강의 서비스로 넘어가고, (A)의 'For example, she watches various academic lectures'는 (B)의 video lecture service를 구체적으로 풀어 주는 예시이므로 (B) 뒤에 와야 한다. (A) 후반의 'During weekends'가 주말 장면으로 글을 맺는다.\n논리 흐름 요약: 아침 식사(C) → 방과 후 강의 서비스(B) → 강의 예시·주말(A)."
E['1o3'] = "③이 정답입니다. 주어진 글에서 지윤은 스마트폰의 음악 스트리밍 서비스에 접속하며 하루를 시작한다. (B)의 'She enjoys listening to her favorite music'은 She가 지윤을, music이 앞의 music streaming service를 받으므로 바로 이어진다. 다음은 아침 시간대인 (C)의 'For a healthy breakfast'로 채소·과일 구독 배송이 나온다. 이어서 (A)가 'After school'로 방과 후의 동영상 강의, 'For example'의 예시, 'During weekends'의 주말 스트리밍까지 시간 순으로 전개한다.\n논리 흐름 요약: 아침 음악 감상(B) → 아침 식사 배송(C) → 방과 후·주말 서비스(A)."
E['1i1'] = "④가 정답입니다. 주어진 문장은 'For example'로 시작해 지윤이 다양한 학술 강의를 보며 학교 공부를 복습한다는 구체적 사례를 든다. 따라서 앞에는 이 예시가 설명할 진술이 와야 하는데, ④ 바로 앞 문장 'Jiyun utilizes a video lecture service to expand her knowledge'가 바로 동영상 강의 서비스 이용을 말한다. ④ 뒤의 'During weekends'는 주말로 장면을 바꾸므로 강의 예시는 그 전에 끝나야 한다. ①~③ 자리에는 강의에 대한 언급이 아직 없어 예시가 받을 대상이 없다.\n논리 흐름 요약: 방과 후 동영상 강의 이용 → (예: 학술 강의로 복습) → 주말 가족 스트리밍."
E['1i2'] = "①이 정답입니다. 주어진 문장 'She enjoys listening to her favorite music'은 음악을 즐기는 모습이므로, 음악 스트리밍 서비스가 먼저 언급된 뒤에 와야 한다. ① 앞 문장이 바로 'logging in to a music streaming service on her smartphone'으로 지윤이 음악 스트리밍에 접속하는 장면이며, She는 Jiyun을 가리킨다. ② 이후로는 아침 식사 배송, 방과 후 강의, 주말 영화로 화제가 바뀌어 음악 감상이 끼어들 연결 고리가 없다.\n논리 흐름 요약: 음악 스트리밍 접속 → (좋아하는 음악 감상·새 아티스트 탐색) → 아침 식사 → 방과 후 → 주말."
E['1i3'] = "③이 정답입니다. 주어진 문장은 'After school'로 시간대를 방과 후로 옮기며 지윤이 동영상 강의 서비스를 이용한다고 말한다. ③ 뒤 문장 'For example, she watches various academic lectures'는 강의 이용의 예시이므로, 그 앞에 동영상 강의 서비스를 소개하는 문장이 반드시 있어야 한다. 또 ③ 앞은 'For a healthy breakfast'의 아침 장면이라 시간 흐름상 방과 후가 그다음에 오는 것이 자연스럽다. ④·⑤ 자리는 예시가 이미 나온 뒤라 예시가 받을 대상이 사라진다.\n논리 흐름 요약: 아침 식사 배송 → (방과 후 동영상 강의 이용) → 학술 강의 예시 → 주말."

E['2o1'] = "①이 정답입니다. 주어진 글은 구독 경제가 요즘 인기 있는 경제 모델이며 지윤도 참여하고 있다고 말한다. (A)는 'The concept of business models based on subscriptions is not new'로 그 역사를 꺼내, 처음에는 우유·신문에 한정되었다가 'However'로 전 산업으로 확장되었다고 전개한다. (C)는 확장 이후 기업이 지속적 가치를 우선시한다고 설명하고, 양측의 장점을 예고한다. (B)는 'Companies can have a stable revenue'와 'From the consumers' perspective'로 두 주체의 장점을 차례로 풀고 성장 요인으로 맺는다.\n논리 흐름 요약: 역사·확장(A) → 기업 전략·장점 예고(C) → 기업·소비자 장점(B)."
E['2o2'] = "④가 정답입니다. 주어진 글은 구독 기반 사업 모델이라는 개념이 새롭지 않다고 말한다. (C)의 'Initially it was limited to products such as milk and newspapers'에서 it은 그 개념을 가리키고, 'However'로 오늘날 모든 산업으로 확장되었다고 이어 간다. (A)는 확장 이후 기업이 지속적 가치를 우선시하는 변화를 설명하고, 'Companies can have a stable revenue'로 기업 측 장점을 말한다. (B)의 'From the consumers' perspective'는 기업 측 장점에 이어 소비자 측 장점을 대비해 제시하므로 (A) 뒤에 온다.\n논리 흐름 요약: 개념의 기원·확장(C) → 기업 전략과 기업 장점(A) → 소비자 장점·성장 요인(B)."
E['2o3'] = "②가 정답입니다. 주어진 글이 구독 경제를 요즘 인기 있는 모델로 소개하자, (B)는 'The concept ... is not new'로 그 개념의 기원을 밝히며 처음에는 우유와 신문에 한정되었다고 말한다. (A)의 'However, these business models have expanded'는 'Initially ... limited'와 대비되므로 (B) 바로 뒤에 온다. (A)가 지속적 가치와 정기 구독료 구조를 설명한 뒤, (C)의 'brings advantages for both companies and consumers'가 양측의 장점과 성장 요인으로 글을 넓힌다.\n논리 흐름 요약: 개념의 기원(B) → 전 산업 확장·지속 가치(A) → 양측의 장점·성장 요인(C)."
E['2i1'] = "⑤가 정답입니다. 주어진 문장 'Customers pay for these benefits via a regular subscription'의 these benefits는 앞에서 구체적으로 제시된 혜택을 가리켜야 한다. ⑤ 앞 문장이 새 콘텐츠·개인화·업데이트 같은 지속적 가치를 기업이 제공한다고 나열하므로, 이 혜택에 고객이 정기 구독료를 낸다는 흐름이 자연스럽다. ⑤ 뒤에는 'The subscription economy brings advantages for both companies and consumers'가 이어져 장점 논의로 넘어간다. ①~④ 자리에는 these benefits가 가리킬 혜택이 아직 등장하지 않는다.\n논리 흐름 요약: 기업이 지속적 가치를 제공 → (고객은 이 혜택에 정기 구독료 지불) → 기업·소비자 양측의 장점."
E['2i2'] = "③이 정답입니다. 주어진 문장은 기업이 구독 모델로 안정적인 수익과 고객 충성도를 얻는다는 기업 측 장점이다. ③ 앞 문장 'The subscription economy brings advantages for both companies and consumers'가 두 주체의 장점을 예고하고, ③ 뒤 문장 'From the consumers' perspective'가 소비자 측 장점을 말하므로, 그 사이에 기업 측 장점이 와야 대비가 성립한다. ①·②에 넣으면 장점을 예고하는 문장보다 먼저 장점이 나오고, ④·⑤ 자리는 이미 소비자 쪽 설명이 진행 중이라 어울리지 않는다.\n논리 흐름 요약: 양측의 장점 예고 → (기업: 안정적 수익·충성도) → 소비자: 다양한 선택·비용 절약."
E['2i3'] = "①이 정답입니다. 주어진 문장은 'However'로 시작해 이 사업 모델들이 오락·기술·패션·교육 등 모든 산업으로 확장되었다고 말한다. However가 대비할 내용은 ① 앞 문장 'Initially it was limited to products such as milk and newspapers'로, 처음에는 몇몇 상품에 국한되었다가 이후 확장되었다는 대조가 성립한다. ① 뒤 문장 'companies now prioritize providing continuing value'도 확장 이후 기업의 변화를 말하므로 흐름이 매끄럽다. ②~⑤ 자리는 이미 현재 기업 전략과 장점을 다루고 있어 초기 상태와 대비할 수 없다.\n논리 흐름 요약: 초기에는 우유·신문에 한정 → (그러나 모든 산업으로 확장) → 지속적 가치 중심의 기업 전략."

E['3o1'] = "⑤가 정답입니다. 주어진 글은 점점 더 많은 사람이 소유보다 경험을 중시한다고 말한다. (C)의 'This makes the subscription economy attractive to them'에서 This는 경험 중시 경향을, them은 그 사람들을 가리키며, 음악 스트리밍과 의류 구독 예시가 이어진다. (B)는 'Moreover'로 다양성과 맞춤화라는 두 번째 경향을 추가하고 젊은 세대의 개인 취향을 강조한다. (A)의 'A popular example ... is the cosmetics subscription service'는 개인 맞춤의 대표 사례로 화장품 구독을 들고 'To come to the point'로 결론을 맺는다.\n논리 흐름 요약: 소유보다 접근(C) → 다양성·맞춤화(B) → 화장품 구독 사례와 결론(A)."
E['3o2'] = "③이 정답입니다. 주어진 글은 구독 경제가 요즘 사람들의 소비 방식과 관련이 깊다고 말한다. (B)는 사람들이 소유보다 경험을 중시한다는 경향을 제시하고 'For example'로 음악 스트리밍 예시를 든다. (C)의 'Another example is subscribing to clothing services'는 첫 번째 예시에 이은 두 번째 예시이므로 (B) 뒤에 오며, 'Moreover'로 다양성·맞춤화를 추가하고 개인화 선택지를 설명한다. (A)의 'This aspect of the subscription economy'는 (C) 끝의 개인화 측면을 받아 젊은 세대의 선호를 말하고, 화장품 구독 사례로 마무리한다.\n논리 흐름 요약: 경험 중시와 첫 예시(B) → 둘째 예시·맞춤화(C) → 젊은 세대·화장품 사례(A)."
E['3o3'] = "①이 정답입니다. 주어진 글이 구독 경제와 오늘날 소비 방식의 관련성을 제시하자, (A)는 사람들이 소유보다 경험을 중시하며 그래서 구독 경제가 소유 없는 접근을 제공해 매력적이라고 말한다. (C)의 'For example'은 소유 없이 누리는 음악 스트리밍·의류 구독 예시로 (A)를 뒷받침하고, 끝에서 'Moreover, consumers value diversity and customization'으로 새 경향을 꺼낸다. (B)의 'The subscription economy offers a diverse range of subscription options'는 바로 그 다양성·맞춤화 요구에 대한 응답이므로 (C) 뒤에 온다.\n논리 흐름 요약: 소유보다 접근(A) → 사례와 다양성 경향(C) → 맞춤형 선택지·화장품 사례(B)."
E['3i1'] = "②가 정답입니다. 주어진 문장 'This makes the subscription economy attractive to them'에서 This는 사람들이 소유보다 경험을 중시하는 경향을, them은 그 사람들을 가리킨다. ② 앞 문장이 바로 'More and more people prioritize experiences over owning things'이므로 지시 대상이 분명해진다. ② 뒤 문장 'For example, by subscribing to a music streaming service'는 소유 없이 접근하는 사례이므로, 소유 없는 접근을 말한 주어진 문장 뒤에 와야 한다. ①에서는 This가 받을 경향이 아직 나오지 않았고, ③ 이후는 예시가 이미 진행 중이다.\n논리 흐름 요약: 경험을 중시 → (그래서 소유 없는 접근이 매력적) → 음악 스트리밍·의류 구독 예시."
E['3i2'] = "④가 정답입니다. 주어진 문장 'Moreover, consumers value diversity and customization'은 앞선 소비 경향에 새로운 경향을 덧붙인다. ④ 앞까지는 소유보다 접근을 중시하는 경향과 음악·의류 구독 예시가 이어지고, ④ 뒤 문장 'The subscription economy offers a diverse range of subscription options, enabling individuals to personalize their experiences'는 다양성·맞춤화 요구에 대한 구독 경제의 대응이다. 따라서 그 요구를 먼저 제시하는 주어진 문장이 ④에 와야 한다. ②·③에 넣으면 예시 흐름이 끊기고, ⑤는 이미 개인화가 설명된 뒤다.\n논리 흐름 요약: 소유 없는 접근과 예시 → (또한 다양성·맞춤화 중시) → 다양한 선택지 제공 → 젊은 세대의 선호."
E['3i3'] = "⑤가 정답입니다. 주어진 문장 'It stands out by thoroughly analyzing customers' current skin conditions'의 It은 피부 상태를 분석할 수 있는 서비스를 가리켜야 한다. ⑤ 앞 문장이 바로 'the cosmetics subscription service'를 소개하므로 It의 지시 대상이 된다. ⑤ 뒤 문장 'To come to the point, consumers receive a personalized experience'는 피부 분석·맞춤 제조를 요약하는 결론이다. ①~④ 자리에는 화장품이나 피부에 대한 언급이 없어 It이 가리킬 대상이 없다.\n논리 흐름 요약: 화장품 구독 사례 소개 → (피부 분석·맞춤 제조로 두드러짐) → 개인 맞춤 경험이라는 결론."

items = [
    order_item(ID1, 1, (3, 5), '②', E['1o1']),
    order_item(ID1, 2, (3, 4), '⑤', E['1o2']),
    order_item(ID1, 1, (2, 3), '③', E['1o3']),
    insert_item(ID1, 5, 2, '④', E['1i1']),
    insert_item(ID1, 2, 3, '①', E['1i2']),
    insert_item(ID1, 4, 2, '③', E['1i3']),

    order_item(ID2, 1, (4, 7), '①', E['2o1']),
    order_item(ID2, 2, (4, 8), '④', E['2o2']),
    order_item(ID2, 1, (3, 6), '②', E['2o3']),
    insert_item(ID2, 6, 2, '⑤', E['2i1']),
    insert_item(ID2, 8, 6, '③', E['2i2']),
    insert_item(ID2, 4, 5, '①', E['2i3']),

    order_item(ID3, 2, (5, 8), '⑤', E['3o1']),
    order_item(ID3, 1, (4, 7), '③', E['3o2']),
    order_item(ID3, 1, (3, 6), '①', E['3o3']),
    insert_item(ID3, 3, 2, '②', E['3i1']),
    insert_item(ID3, 6, 3, '④', E['3i2']),
    insert_item(ID3, 10, 6, '⑤', E['3i3']),
]
json.dump(items, open('/Users/goshua/next-order/.variant-drafts/pjy2-l23-shard1.json', 'w'), ensure_ascii=False, indent=1)
print(len(items))
