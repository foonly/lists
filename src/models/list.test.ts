import { describe, expect, it } from "vitest";
import { mergeListItems, tracked, type ListItem } from "./list";
import { stableStringify } from "@/lib/stable-json";

function item(
	id: string,
	fields: Partial<{
		text: [string, number];
		quantity: [number | null, number];
		done: [string | null, number];
		deleted: [boolean, number];
		order: [number, number];
	}> = {},
	user = "alice",
): ListItem {
	const [text, textTs] = fields.text ?? [id, 1];
	const [quantity, qtyTs] = fields.quantity ?? [null, 1];
	const [done, doneTs] = fields.done ?? [null, 1];
	const [deleted, delTs] = fields.deleted ?? [false, 1];
	const [order, orderTs] = fields.order ?? [0, 1];
	return {
		id,
		createdBy: user,
		createdAt: 1,
		text: tracked(text, user, textTs),
		quantity: tracked(quantity, user, qtyTs),
		unit: tracked(null, user, 1),
		group: tracked(null, user, 1),
		order: tracked(order, user, orderTs),
		done: tracked(done, user, doneTs),
		deleted: tracked(deleted, user, delTs),
	};
}

const same = (a: ListItem[], b: ListItem[]) =>
	stableStringify(a) === stableStringify(b);

describe("mergeListItems", () => {
	it("keeps items that exist on only one side", () => {
		const merged = mergeListItems([item("a")], [item("b")]);
		expect(merged.map((i) => i.id).sort()).toEqual(["a", "b"]);
	});

	it("resolves each field independently by timestamp", () => {
		const local = item("a", { text: ["milk", 5], quantity: [1, 1] });
		const remote = item("a", { text: ["oat milk", 2], quantity: [3, 9] });
		const [merged] = mergeListItems([local], [remote]);
		expect(merged.text.value).toBe("milk"); // local edited later
		expect(merged.quantity.value).toBe(3); // remote edited later
	});

	it("keeps a newer soft delete over an older edit", () => {
		const local = item("a", { deleted: [true, 10] });
		const remote = item("a", { text: ["renamed", 5] });
		const [merged] = mergeListItems([local], [remote]);
		expect(merged.deleted.value).toBe(true);
		expect(merged.text.value).toBe("renamed");
	});

	it("breaks timestamp ties the same way regardless of side", () => {
		const x = item("a", { text: ["x", 7] }, "alice");
		const y = item("a", { text: ["y", 7] }, "bob");
		const ab = mergeListItems([x], [y]);
		const ba = mergeListItems([y], [x]);
		expect(ab[0].text.value).toBe(ba[0].text.value);
	});

	it("follows remote order, then appends local-only items", () => {
		const merged = mergeListItems(
			[item("b"), item("a"), item("local")],
			[item("a"), item("b")],
		);
		expect(merged.map((i) => i.id)).toEqual(["a", "b", "local"]);
	});

	it("converges: merging the result again changes nothing", () => {
		const local = [item("a", { text: ["l", 3] }), item("only-local")];
		const remote = [item("a", { done: ["sum", 4] }), item("only-remote")];
		const once = mergeListItems(local, remote);
		expect(same(mergeListItems(once, remote), once)).toBe(true);
		// The other device adopting the result has nothing to push back.
		expect(same(mergeListItems(remote, once), once)).toBe(true);
	});

	it("does not mutate its inputs", () => {
		const local = [item("a", { text: ["old", 1] })];
		const remote = [item("a", { text: ["new", 2] })];
		const before = stableStringify(local);
		mergeListItems(local, remote);
		expect(stableStringify(local)).toBe(before);
	});
});
