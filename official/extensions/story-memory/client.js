import { createContext as e, createElement as t, forwardRef as n, useContext as r, useEffect as i, useRef as a, useState as o } from "react";
import { createRoot as s } from "react-dom/client";
import { Button as c, Field as l, IconButton as u, SearchField as d, Tabs as f, TextInput as p, Textarea as m, Toggle as h } from "@loom-studio/ui";
import { Fragment as g, jsx as _, jsxs as v } from "react/jsx-runtime";
//#region ../../../node_modules/.pnpm/lucide-react@1.17.0_react@19.3.0/node_modules/lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs
var y = (...e) => e.filter((e, t, n) => !!e && e.trim() !== "" && n.indexOf(e) === t).join(" ").trim(), b = (e) => e.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(), x = (e) => e.replace(/^([A-Z])|[\s-_]+(\w)/g, (e, t, n) => n ? n.toUpperCase() : t.toLowerCase()), S = (e) => {
	let t = x(e);
	return t.charAt(0).toUpperCase() + t.slice(1);
}, C = {
	xmlns: "http://www.w3.org/2000/svg",
	width: 24,
	height: 24,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 2,
	strokeLinecap: "round",
	strokeLinejoin: "round"
}, w = (e) => {
	for (let t in e) if (t.startsWith("aria-") || t === "role" || t === "title") return !0;
	return !1;
}, T = e({}), E = () => r(T), D = n(({ color: e, size: n, strokeWidth: r, absoluteStrokeWidth: i, className: a = "", children: o, iconNode: s, ...c }, l) => {
	let { size: u = 24, strokeWidth: d = 2, absoluteStrokeWidth: f = !1, color: p = "currentColor", className: m = "" } = E() ?? {}, h = i ?? f ? Number(r ?? d) * 24 / Number(n ?? u) : r ?? d;
	return t("svg", {
		ref: l,
		...C,
		width: n ?? u ?? C.width,
		height: n ?? u ?? C.height,
		stroke: e ?? p,
		strokeWidth: h,
		className: y("lucide", m, a),
		...!o && !w(c) && { "aria-hidden": "true" },
		...c
	}, [...s.map(([e, n]) => t(e, n)), ...Array.isArray(o) ? o : [o]]);
}), O = (e, r) => {
	let i = n(({ className: n, ...i }, a) => t(D, {
		ref: a,
		iconNode: r,
		className: y(`lucide-${b(S(e))}`, `lucide-${e}`, n),
		...i
	}));
	return i.displayName = S(e), i;
}, k = O("arrow-left", [["path", {
	d: "m12 19-7-7 7-7",
	key: "1l729n"
}], ["path", {
	d: "M19 12H5",
	key: "x3x0zl"
}]]), A = O("book-open", [["path", {
	d: "M12 7v14",
	key: "1akyts"
}], ["path", {
	d: "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
	key: "ruj8y"
}]]), j = O("check", [["path", {
	d: "M20 6 9 17l-5-5",
	key: "1gmf2c"
}]]), M = O("chevron-right", [["path", {
	d: "m9 18 6-6-6-6",
	key: "mthhwq"
}]]), N = O("file-text", [
	["path", {
		d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
		key: "1oefj6"
	}],
	["path", {
		d: "M14 2v5a1 1 0 0 0 1 1h5",
		key: "wfsgrz"
	}],
	["path", {
		d: "M10 9H8",
		key: "b1mrlr"
	}],
	["path", {
		d: "M16 13H8",
		key: "t4e002"
	}],
	["path", {
		d: "M16 17H8",
		key: "z1uh3a"
	}]
]), P = O("layers", [
	["path", {
		d: "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z",
		key: "zw3jo"
	}],
	["path", {
		d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12",
		key: "1wduqc"
	}],
	["path", {
		d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",
		key: "kqbvx6"
	}]
]), F = O("refresh-cw", [
	["path", {
		d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
		key: "v9h5vc"
	}],
	["path", {
		d: "M21 3v5h-5",
		key: "1q7to0"
	}],
	["path", {
		d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
		key: "3uifl3"
	}],
	["path", {
		d: "M8 16H3v5",
		key: "1cv678"
	}]
]), I = O("settings", [["path", {
	d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
	key: "1i5ecw"
}], ["circle", {
	cx: "12",
	cy: "12",
	r: "3",
	key: "1v7zrd"
}]]), L = O("sparkles", [
	["path", {
		d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
		key: "1s2grr"
	}],
	["path", {
		d: "M20 2v4",
		key: "1rf3ol"
	}],
	["path", {
		d: "M22 4h-4",
		key: "gwowj6"
	}],
	["circle", {
		cx: "4",
		cy: "20",
		r: "2",
		key: "6kqj1y"
	}]
]), R = O("x", [["path", {
	d: "M18 6 6 18",
	key: "1bl5f8"
}], ["path", {
	d: "m6 6 12 12",
	key: "d8bk6v"
}]]), z = {
	pending: "准备中",
	running: "生成中",
	draft: "待确认",
	confirmed: "等待采用",
	failed: "生成失败",
	cancelled: "已取消",
	interrupted: "已中断",
	discarded: "已丢弃"
}, B = (e) => e.valid ? e.resident ? "常驻注入" : e.published ? "等待探索" : z[e.status] ?? e.status : "来源已变化", V = (e) => `${e.fromFloor}–${e.throughFloor} 楼`, H = [
	[
		"batchFloors",
		"每批正文楼数",
		"按固定范围准备 LV1 摘要。",
		1,
		500
	],
	[
		"bufferFloors",
		"原文缓冲楼数",
		"首次采用前保留最近的正文；0 表示不保留缓冲。",
		0,
		500
	],
	[
		"lv1Budget",
		"LV1 输出上限",
		"单份原文摘要的 Token 上限。",
		100,
		32e3
	],
	[
		"lv2Count",
		"LV1 数量阈值",
		"达到此数量，或下方 Token 阈值，即可准备 LV2。",
		2,
		100
	],
	[
		"lv2Tokens",
		"LV1 累计 Token 阈值",
		"只计算尚未被 LV2 覆盖的常驻 LV1，至少两份。",
		100,
		5e5
	],
	[
		"lv2Budget",
		"LV2 输出上限",
		"跨摘要压缩后的 Token 上限。",
		100,
		64e3
	]
];
function U({ snapshot: e, busy: t, save: n, back: r }) {
	let [i, a] = o(e.policy), [s] = o(e.policyVersion);
	return /* @__PURE__ */ v("form", {
		className: "settings",
		onSubmit: (e) => {
			e.preventDefault(), n(i, s);
		},
		children: [
			/* @__PURE__ */ v("header", {
				className: "detailHeading",
				children: [/* @__PURE__ */ _(u, {
					"aria-label": "返回摘要",
					onClick: r,
					children: /* @__PURE__ */ _(k, { size: 16 })
				}), /* @__PURE__ */ v("div", { children: [/* @__PURE__ */ _("h2", { children: "总结设置" }), /* @__PURE__ */ _("p", { children: "仅应用于当前故事" })] })]
			}),
			/* @__PURE__ */ v("div", {
				className: "settingsBody",
				children: [
					/* @__PURE__ */ v("div", {
						className: "switchRow",
						children: [/* @__PURE__ */ v("div", { children: [/* @__PURE__ */ _("strong", { children: "自动准备摘要" }), /* @__PURE__ */ _("p", { children: "后台整理固定来源，不阻塞主剧情。生成后仍需整批确认。" })] }), /* @__PURE__ */ _(h, {
							label: "自动准备摘要",
							checked: i.enabled,
							disabled: t,
							onChange: (e) => a({
								...i,
								enabled: e
							})
						})]
					}),
					["原文总结 · LV1", "分层压缩 · LV2"].map((e, n) => /* @__PURE__ */ v("section", {
						className: "settingsGroup",
						children: [/* @__PURE__ */ _("h3", { children: e }), H.slice(n * 3, n * 3 + 3).map(([e, n, r, o, s]) => /* @__PURE__ */ _(l, {
							id: `memory-${e}`,
							label: n,
							description: r,
							children: (n) => /* @__PURE__ */ _(p, {
								...n,
								name: e,
								inputMode: "numeric",
								pattern: "[0-9]+",
								required: !0,
								disabled: t,
								value: String(i[e]),
								onChange: (t) => a({
									...i,
									[e]: Number(t.target.value)
								}),
								onBlur: (e) => e.target.setCustomValidity(Number(e.target.value) < o || Number(e.target.value) > s ? `请输入 ${o}–${s} 之间的整数` : ""),
								onInput: (e) => e.currentTarget.setCustomValidity("")
							})
						}, e))]
					}, e)),
					/* @__PURE__ */ v("section", {
						className: "presetHint",
						children: [/* @__PURE__ */ _(A, { size: 18 }), /* @__PURE__ */ v("div", { children: [/* @__PURE__ */ _("strong", { children: "提示词与模型" }), /* @__PURE__ */ _("p", { children: "在 Agent 预设中打开「剧情总结」配置模型和提示词。LV1 / LV2 共用一个预设，角色世界书通过锚点提供参考。" })] })]
					})
				]
			}),
			/* @__PURE__ */ v("footer", {
				className: "footer",
				children: [/* @__PURE__ */ _("span", {
					className: "muted",
					children: "设置不会重写已生成的摘要。"
				}), /* @__PURE__ */ v(c, {
					disabled: t,
					type: "submit",
					children: [/* @__PURE__ */ _(j, { size: 16 }), "保存设置"]
				})]
			})
		]
	});
}
function W({ call: e }) {
	let [t, n] = o(), [r, s] = o(""), [p, h] = o(!1), [y, b] = o(), [x, S] = o("list"), [C, w] = o(""), [T, E] = o("all"), [D, O] = o({}), [z, H] = o(), [W, G] = o(!1), K = a(!0), q = a(!1), J = a(!1);
	async function Y() {
		if (!J.current) {
			J.current = !0;
			try {
				let t = await e("status");
				K.current && n(t);
			} catch (e) {
				K.current && s(e instanceof Error ? e.message : String(e));
			} finally {
				J.current = !1;
			}
		}
	}
	i(() => {
		K.current = !0;
		let e;
		async function t() {
			await Y(), K.current && (e = setTimeout(t, 3e3));
		}
		return t(), () => {
			K.current = !1, clearTimeout(e);
		};
	}, [e]);
	async function X(t, n = {}) {
		if (q.current && t !== "cancel") return;
		let r = t !== "cancel";
		r && (q.current = !0, h(!0)), s("");
		try {
			let r = await e(t, n);
			if (!K.current) return;
			r?.id && (b(r.id), S("detail")), t === "prepare" && !r && s("当前没有可生成的新批次，请查看已有摘要的处理状态。"), t === "configure" && S("list"), await Y();
		} catch (e) {
			K.current && s(e instanceof Error ? e.message : String(e));
		} finally {
			r && (q.current = !1, K.current && h(!1));
		}
	}
	let Z = t?.batches.find((e) => e.id === y) ?? t?.batches.find((e) => e.status === "draft") ?? t?.batches[0], Q = t?.batches.filter((e) => `${V(e)} ${e.text}`.toLowerCase().includes(C.toLowerCase()) && (T === "all" || T === "draft" && !["confirmed", "discarded"].includes(e.status) || T === "resident" && e.resident || T === "explore" && e.status === "confirmed" && !e.resident && e.valid)) ?? [], $ = t?.batches.some((e) => e.running);
	return /* @__PURE__ */ v("section", {
		className: "memory",
		"aria-label": "剧情记忆工作台",
		"data-page": x,
		children: [
			/* @__PURE__ */ v("header", {
				className: "toolbar",
				children: [/* @__PURE__ */ v("div", {
					className: "summary",
					children: [
						/* @__PURE__ */ _(P, { size: 18 }),
						/* @__PURE__ */ _("strong", { children: "剧情摘要" }),
						/* @__PURE__ */ _("span", { children: t ? `${t.batches.filter((e) => e.resident).length} 份常驻 · 当前 ${t.headFloor} 楼` : "正在加载…" })
					]
				}), /* @__PURE__ */ v("div", {
					className: "actions",
					children: [
						/* @__PURE__ */ v(c, {
							disabled: !t || p || $,
							onClick: () => void X("prepare", { level: 1 }),
							children: [/* @__PURE__ */ _(L, { size: 15 }), "立即总结 LV1"]
						}),
						/* @__PURE__ */ v(c, {
							disabled: !t || p || $,
							onClick: () => void X("prepare", { level: 2 }),
							children: [/* @__PURE__ */ _(P, { size: 15 }), "压缩 LV2"]
						}),
						/* @__PURE__ */ _(u, {
							"aria-label": "刷新剧情记忆",
							onClick: () => {
								s(""), Y();
							},
							children: /* @__PURE__ */ _(F, { size: 16 })
						}),
						/* @__PURE__ */ _(u, {
							"aria-label": "总结设置",
							disabled: !t,
							onClick: () => S(x === "settings" ? "list" : "settings"),
							children: /* @__PURE__ */ _(I, { size: 16 })
						})
					]
				})]
			}),
			r && /* @__PURE__ */ v("div", {
				className: "notice",
				role: "alert",
				children: [/* @__PURE__ */ _("span", { children: r }), /* @__PURE__ */ _(u, {
					"aria-label": "关闭提示",
					onClick: () => s(""),
					children: /* @__PURE__ */ _(R, { size: 14 })
				})]
			}),
			t ? x === "settings" ? /* @__PURE__ */ _(U, {
				snapshot: t,
				busy: p,
				back: () => S("list"),
				save: (e, t) => void X("configure", {
					value: e,
					expectedVersion: t
				})
			}) : /* @__PURE__ */ v("div", {
				className: "workbench",
				children: [/* @__PURE__ */ v("aside", {
					className: "sidebar",
					"aria-label": "摘要列表",
					children: [
						/* @__PURE__ */ v("div", {
							className: "filters",
							children: [/* @__PURE__ */ _(d, {
								"aria-label": "搜索摘要",
								placeholder: "搜索楼层或正文",
								clearLabel: "清空搜索",
								value: C,
								onChange: (e) => w(e.target.value),
								onClear: () => w("")
							}), /* @__PURE__ */ _(f, {
								ariaLabel: "筛选摘要",
								size: "compact",
								activeId: T,
								onChange: E,
								items: [
									{
										id: "all",
										label: "全部"
									},
									{
										id: "draft",
										label: "待处理"
									},
									{
										id: "resident",
										label: "常驻"
									},
									{
										id: "explore",
										label: "探索"
									}
								]
							})]
						}),
						/* @__PURE__ */ v("nav", {
							className: "list",
							"aria-label": "摘要批次",
							children: [Q.map((e) => /* @__PURE__ */ v(c, {
								className: "batch",
								"aria-current": e.id === Z?.id ? "true" : void 0,
								onClick: () => {
									b(e.id), S("detail");
								},
								children: [
									/* @__PURE__ */ v("span", {
										className: "level",
										children: ["L", e.level]
									}),
									/* @__PURE__ */ v("span", {
										className: "batchIdentity",
										children: [/* @__PURE__ */ v("strong", { children: ["第 ", V(e)] }), /* @__PURE__ */ v("small", { children: [
											B(e),
											" · ",
											e.tokenCount,
											" Token"
										] })]
									}),
									/* @__PURE__ */ _(M, { size: 14 })
								]
							}, e.id)), !Q.length && /* @__PURE__ */ _("p", {
								className: "listEmpty",
								children: t.batches.length ? "没有匹配的摘要" : "还没有剧情摘要"
							})]
						}),
						/* @__PURE__ */ v("div", {
							className: "sidebarFoot",
							children: [
								"每 ",
								t.policy.batchFloors,
								" 楼一批 · 缓冲 ",
								t.policy.bufferFloors,
								" 楼",
								/* @__PURE__ */ _(c, {
									size: "small",
									onClick: () => S("settings"),
									children: "调整"
								})
							]
						})
					]
				}), /* @__PURE__ */ _("main", {
					className: "detail",
					children: Z ? /* @__PURE__ */ v(g, { children: [
						/* @__PURE__ */ v("header", {
							className: "detailHeading",
							children: [
								/* @__PURE__ */ _(u, {
									className: "back",
									"aria-label": "返回摘要列表",
									onClick: () => S("list"),
									children: /* @__PURE__ */ _(k, { size: 16 })
								}),
								/* @__PURE__ */ _(N, { size: 20 }),
								/* @__PURE__ */ v("div", { children: [/* @__PURE__ */ v("h2", { children: [
									"LV",
									Z.level,
									" · 第 ",
									V(Z)
								] }), /* @__PURE__ */ v("p", { children: [
									Z.tokenCount,
									" / ",
									Z.budget,
									" Token · 版本 ",
									Z.version
								] })] }),
								/* @__PURE__ */ _("span", {
									className: "badge",
									"data-invalid": !Z.valid,
									children: B(Z)
								})
							]
						}),
						/* @__PURE__ */ v("div", {
							className: "body",
							children: [
								!Z.valid && /* @__PURE__ */ _("p", {
									className: "warning",
									children: "来源已不属于当前剧情，这份摘要不会注入，也不能确认。"
								}),
								Z.error && /* @__PURE__ */ _("p", {
									className: "warning",
									children: Z.error
								}),
								/* @__PURE__ */ _("article", {
									className: "text",
									children: Z.text || (Z.running ? "正在整理固定来源，你可以继续主剧情写作。" : "尚无摘要正文，可在下方重试生成。")
								}),
								/* @__PURE__ */ v("details", {
									className: "sources",
									children: [
										/* @__PURE__ */ _("summary", { children: "来源与覆盖范围" }),
										/* @__PURE__ */ _("p", {
											className: "muted",
											children: Z.level === 1 ? `原文第 ${V(Z)}` : `${Z.inputs?.length ?? 0} 份 LV1 摘要 · 第 ${V(Z)}`
										}),
										/* @__PURE__ */ _(c, {
											disabled: !Z.valid || W,
											onClick: async () => {
												G(!0);
												try {
													let t = await e("source", { id: Z.id });
													K.current && H({
														id: Z.id,
														text: t.text
													});
												} catch (e) {
													K.current && s(e instanceof Error ? e.message : String(e));
												} finally {
													K.current && G(!1);
												}
											},
											children: W ? "正在读取…" : "读取固定来源"
										}),
										z?.id === Z.id && /* @__PURE__ */ _("pre", {
											className: "source",
											children: z.text
										})
									]
								}, Z.id)
							]
						}),
						/* @__PURE__ */ _("footer", {
							className: "review",
							children: Z.status === "confirmed" ? /* @__PURE__ */ _("p", {
								className: "muted",
								children: Z.valid ? Z.resident ? "这份摘要已纳入当前剧情上下文。" : Z.published ? "已由高层摘要覆盖，保留供探索。" : "已确认，达到原文缓冲边界后自动采用。" : "来源失效，已停止注入。"
							}) : Z.running ? /* @__PURE__ */ v("div", {
								className: "actions",
								children: [/* @__PURE__ */ _("span", {
									className: "muted",
									role: "status",
									children: "正在生成摘要…"
								}), /* @__PURE__ */ _(c, {
									onClick: () => void X("cancel", { id: Z.id }),
									children: "取消生成"
								})]
							}) : Z.status !== "discarded" && Z.valid ? /* @__PURE__ */ v(g, { children: [/* @__PURE__ */ _(l, {
								id: "memory-revision",
								label: "修订要求",
								children: (e) => /* @__PURE__ */ _(m, {
									...e,
									value: D[Z.id] ?? "",
									placeholder: "补充遗漏的事件、人物承诺或因果关系…",
									onChange: (e) => O({
										...D,
										[Z.id]: e.target.value
									}),
									rows: 3
								})
							}), /* @__PURE__ */ v("div", {
								className: "reviewActions",
								children: [
									/* @__PURE__ */ _(c, {
										variant: "danger",
										disabled: p,
										onClick: () => void X("discard", {
											id: Z.id,
											version: Z.version
										}),
										children: "丢弃草稿"
									}),
									/* @__PURE__ */ _("span", {}),
									/* @__PURE__ */ _(c, {
										disabled: p,
										onClick: () => void X("revise", {
											id: Z.id,
											version: Z.version,
											input: D[Z.id]?.trim() || "请重新整理完整摘要，保留必要事实与因果，并遵守输出上限。"
										}),
										children: [
											"failed",
											"cancelled",
											"interrupted"
										].includes(Z.status) ? "重试生成" : "提交修订"
									}),
									/* @__PURE__ */ v(c, {
										disabled: p || Z.status !== "draft" || Z.tokenCount > Z.budget || !Z.text.trim(),
										onClick: () => void X("confirm", {
											id: Z.id,
											version: Z.version
										}),
										children: [/* @__PURE__ */ _(j, { size: 16 }), "确认整批摘要"]
									})
								]
							})] }) : null
						})
					] }) : /* @__PURE__ */ v("div", {
						className: "empty",
						children: [
							/* @__PURE__ */ _(A, { size: 32 }),
							/* @__PURE__ */ _("h2", { children: "为故事留下一份记忆" }),
							/* @__PURE__ */ v("p", { children: [
								"原文分批整理为 LV1，积累后压缩为 LV2。",
								/* @__PURE__ */ _("br", {}),
								"确认采用后，仍能回查原文与下层摘要。"
							] }),
							/* @__PURE__ */ v(c, {
								onClick: () => S("settings"),
								children: [/* @__PURE__ */ _(I, { size: 16 }), "配置总结"]
							}),
							/* @__PURE__ */ _("small", { children: "首次使用请在「剧情总结」预设中选择模型。" })
						]
					})
				})]
			}) : /* @__PURE__ */ v("div", {
				className: "empty",
				children: [
					/* @__PURE__ */ _(A, { size: 28 }),
					/* @__PURE__ */ _("p", { children: r ? "剧情记忆暂时无法读取" : "正在读取剧情记忆…" }),
					r && /* @__PURE__ */ _(c, {
						onClick: () => void Y(),
						children: "重试"
					})
				]
			})
		]
	});
}
//#endregion
//#region ui/panel.module.css?inline
var G = ":host{height:100%;min-height:0;display:flex!important}[data-loom-renderer-shadow-root]{flex:1;min-width:0;min-height:0;display:flex}.memory{min-width:0;min-height:0;color:var(--loom-color-text);font:var(--loom-font-size-2,14px)/1.6 var(--loom-font-family-sans,sans-serif);pointer-events:auto;flex-direction:column;flex:1;display:flex;container-type:inline-size}.memory *{box-sizing:border-box}.memory h2,.memory h3,.memory p{margin:0}.memory h2{font-size:var(--loom-font-size-3,16px);font-weight:600}.memory h3{font-size:var(--loom-font-size-2,14px);font-weight:600}.toolbar,.summary,.actions,.detailHeading,.footer,.notice,.switchRow{align-items:center;gap:10px;display:flex}.toolbar{border-bottom:1px solid var(--loom-color-divider);flex-wrap:wrap;flex:none;padding:10px 16px}.summary{flex-wrap:wrap;flex:1}.summary>span,.muted,.detailHeading p,.settingsBody p{color:var(--loom-color-text-muted);font-size:var(--loom-font-size-1,12px)}.actions{flex-wrap:wrap;gap:4px}.notice{color:var(--loom-color-danger);background:var(--loom-color-surface-subtle);border-radius:var(--loom-radius-control);margin:8px 16px;padding:8px 12px}.notice>span{overflow-wrap:anywhere;flex:1}.workbench{flex:1;grid-template-columns:280px minmax(0,1fr);min-height:0;display:grid}.sidebar{border-right:1px solid var(--loom-color-divider);flex-direction:column;min-height:0;display:flex}.filters{flex-direction:column;gap:12px;padding:12px 12px 0;display:flex}.list{flex:1;min-height:0;padding:8px;overflow:auto}.batch[data-loom-ui-button]{text-align:left;border-radius:var(--loom-radius-control);justify-content:flex-start;gap:10px;width:100%;padding:12px 10px}.batch[aria-current=true]{background:var(--loom-color-accent-soft)}.batch:hover{background:var(--loom-color-surface-subtle)}.batchIdentity{flex-direction:column;flex:1;gap:3px;min-width:0;display:flex}.batchIdentity small{color:var(--loom-color-text-muted);font-weight:400;font-size:var(--loom-font-size-1,12px)}.level{font-size:var(--loom-font-size-1,12px);color:var(--loom-color-accent)}.listEmpty{color:var(--loom-color-text-muted);padding:16px}.sidebarFoot{font-size:var(--loom-font-size-1,12px);color:var(--loom-color-text-muted);border-top:1px solid var(--loom-color-divider);justify-content:space-between;align-items:center;padding:10px 12px;display:flex}.detail,.settings{flex-direction:column;flex:1;min-width:0;min-height:0;display:flex}.detailHeading{border-bottom:1px solid var(--loom-color-divider);flex:none;padding:16px 20px}.detailHeading>div{flex:1;min-width:0}.detailHeading p{margin-top:3px}.badge{font-size:var(--loom-font-size-1,12px);background:var(--loom-color-surface-subtle);border-radius:var(--loom-radius-control);white-space:nowrap;padding:3px 8px}.badge[data-invalid=true],.warning{color:var(--loom-color-danger)}.body{flex:1;min-height:0;padding:20px 24px;overflow:auto}.text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85}.warning{margin-bottom:16px!important}.sources{border-top:1px solid var(--loom-color-divider);margin-top:28px;padding-top:12px}.sources summary{cursor:pointer;color:var(--loom-color-text-muted);margin-bottom:10px}.source{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--loom-color-surface-subtle);max-height:320px;font-size:var(--loom-font-size-1,12px);padding:12px;overflow:auto}.review{border-top:1px solid var(--loom-color-divider);flex:none;padding:14px 20px}.reviewActions{flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px;display:flex}.reviewActions>span{flex:1}.review textarea{resize:vertical;max-height:180px}.empty{text-align:center;color:var(--loom-color-text-muted);flex-direction:column;align-items:center;gap:14px;margin:auto;padding:32px 24px;display:flex}.empty h2{color:var(--loom-color-text)}.empty small{font-size:var(--loom-font-size-1,12px)}.settingsBody{flex:1;min-height:0;padding:20px 24px;overflow:auto}.switchRow{justify-content:space-between;max-width:760px;padding-bottom:20px}.settingsGroup{border-top:1px solid var(--loom-color-divider);grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;max-width:760px;padding:20px 0;display:grid}.settingsGroup h3{grid-column:1/-1}.presetHint{background:var(--loom-color-surface-subtle);border-radius:var(--loom-radius-control);align-items:flex-start;gap:12px;max-width:760px;padding:16px;display:flex}.presetHint svg{flex:none;margin-top:3px}.footer{border-top:1px solid var(--loom-color-divider);flex:none;justify-content:space-between;padding:12px 20px}.back[data-loom-ui-icon-button]{display:none}@container (width<=639px){.workbench{grid-template-columns:minmax(0,1fr)}.memory[data-page=list] .detail,.memory[data-page=detail] .sidebar{display:none}.back[data-loom-ui-icon-button]{display:inline-flex}.sidebar{border-right:0}.settingsGroup{grid-template-columns:1fr}.summary>span{display:none}.body,.settingsBody{padding:16px}}";
//#endregion
//#region ui/entry.tsx
function K(e) {
	e.renderers.register({
		id: "memory",
		name: "剧情记忆",
		surface: "memory.panel",
		instanceScope: "timeline",
		adapter: "shadow"
	}, { mount(t) {
		let n = e.timeline?.target;
		if (!n) throw Error("剧情记忆需要当前 Timeline。");
		let r = s(t);
		return r.render(/* @__PURE__ */ v(g, { children: [/* @__PURE__ */ _("style", { children: G }), /* @__PURE__ */ _(W, { call: (t, r = {}) => e.rpc.call(`official.story-memory.${t}`, {
			timelineId: n.timelineId,
			branchId: n.branchId,
			...r
		}) })] })), { dispose() {
			r.unmount();
		} };
	} });
}
//#endregion
export { K as activate };
