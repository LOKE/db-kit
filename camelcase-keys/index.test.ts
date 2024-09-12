import test from "ava";
import camelcaseKeys from ".";

test("basic object", (t) => {
  const modified = camelcaseKeys({ foo_bar: true });
  t.deepEqual(modified, { fooBar: true });
});

test("nested object", (t) => {
  const modified = camelcaseKeys(
    { level_one: { level_two: "ok" } },
    { deep: true }
  );
  t.deepEqual(modified, { levelOne: { levelTwo: "ok" } });
});

test("array", (t) => {
  const modified = camelcaseKeys([{ foo_bar: true }]);
  t.deepEqual(modified, [{ fooBar: true }]);
});
