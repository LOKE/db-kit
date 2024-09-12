import mapObject from "map-obj";
import camelCase from "camelcase";
import QuickLru from "quick-lru";
import type { CamelCase, PascalCase } from "type-fest";

// Copied from https://github.com/sindresorhus/camelcase-keys since the library only supports ESM
// Note repeated use of as any since source was not typescript, assuming it is functionally correct from copy
// Could improve by removing as any and fixing typescript errors

// eslint-disable-next-line @typescript-eslint/ban-types
type EmptyTuple = [];

// Allow union with, for example, `undefined` and `null`.
type ObjectUnion = Record<string, unknown> | unknown;

/**
Return a default type if input type is nil.

@template T - Input type.
@template U - Default type.
*/
type WithDefault<T, U> = T extends undefined | void | null ? U : T; // eslint-disable-line @typescript-eslint/ban-types

/**
Check if an element is included in a tuple.
*/
type IsInclude<List extends readonly unknown[], Target> = List extends undefined
  ? false
  : List extends Readonly<EmptyTuple>
    ? false
    : List extends readonly [infer First, ...infer Rest]
      ? First extends Target
        ? true
        : IsInclude<Rest, Target>
      : boolean;

/**
Append a segment to dot-notation path.
*/
type AppendPath<S extends string, Last extends string> = S extends ""
  ? Last
  : `${S}.${Last}`;

/**
Convert keys of an object to camelcase strings.
*/
export type CamelCaseKeys<
  T extends ObjectUnion | ReadonlyArray<Record<string, unknown>>,
  Deep extends boolean = false,
  IsPascalCase extends boolean = false,
  PreserveConsecutiveUppercase extends boolean = false,
  Exclude extends readonly unknown[] = EmptyTuple,
  StopPaths extends readonly string[] = EmptyTuple,
  Path extends string = "",
> =
  T extends ReadonlyArray<Record<string, unknown>>
    ? // Handle arrays or tuples.
      {
        [P in keyof T]: T[P] extends
          | Record<string, unknown>
          | ReadonlyArray<Record<string, unknown>>
          ? CamelCaseKeys<
              T[P],
              Deep,
              IsPascalCase,
              PreserveConsecutiveUppercase,
              Exclude,
              StopPaths
            >
          : T[P];
      }
    : T extends Record<string, unknown>
      ? // Handle objects.
        {
          [P in keyof T as [IsInclude<Exclude, P>] extends [true]
            ? P
            : [IsPascalCase] extends [true]
              ? PascalCase<P>
              : CamelCase<
                  P,
                  { preserveConsecutiveUppercase: PreserveConsecutiveUppercase }
                >]: [
            IsInclude<StopPaths, AppendPath<Path, P & string>>,
          ] extends [true]
            ? T[P]
            : [Deep] extends [true]
              ? T[P] extends
                  | ObjectUnion
                  | ReadonlyArray<Record<string, unknown>>
                ? CamelCaseKeys<
                    T[P],
                    Deep,
                    IsPascalCase,
                    PreserveConsecutiveUppercase,
                    Exclude,
                    StopPaths,
                    AppendPath<Path, P & string>
                  >
                : T[P]
              : T[P];
        }
      : // Return anything else as-is.
        T;

export type Options = {
  /**
	Exclude keys from being camel-cased.

	If this option can be statically determined, it's recommended to add `as const` to it.

	@default []
	*/
  readonly exclude?: ReadonlyArray<string | RegExp>;

  /**
	Recurse nested objects and objects in arrays.

	@default false

	@example
	```
	import camelcaseKeys from 'camelcase-keys';

	const object = {
		'foo-bar': true,
		nested: {
			unicorn_rainbow: true
		}
	};

	camelcaseKeys(object, {deep: true});
	//=> {fooBar: true, nested: {unicornRainbow: true}}

	camelcaseKeys(object, {deep: false});
	//=> {fooBar: true, nested: {unicorn_rainbow: true}}
	```
	*/
  readonly deep?: boolean;

  /**
	Uppercase the first character: `bye-bye` → `ByeBye`

	@default false

	@example
	```
	import camelcaseKeys from 'camelcase-keys';

	camelcaseKeys({'foo-bar': true}, {pascalCase: true});
	//=> {FooBar: true}

	camelcaseKeys({'foo-bar': true}, {pascalCase: false});
	//=> {fooBar: true}
	````
	*/
  readonly pascalCase?: boolean;

  /**
	Preserve consecutive uppercase characters: `foo-BAR` → `FooBAR`

	@default false

	@example
	```
	import camelcaseKeys from 'camelcase-keys';

	camelcaseKeys({'foo-BAR': true}, {preserveConsecutiveUppercase: true});
	//=> {fooBAR: true}

	camelcaseKeys({'foo-BAR': true}, {preserveConsecutiveUppercase: false});
	//=> {fooBar: true}
	````
	*/
  readonly preserveConsecutiveUppercase?: boolean;

  /**
	Exclude children at the given object paths in dot-notation from being camel-cased. For example, with an object like `{a: {b: '🦄'}}`, the object path to reach the unicorn is `'a.b'`.

	If this option can be statically determined, it's recommended to add `as const` to it.

	@default []

	@example
	```
	import camelcaseKeys from 'camelcase-keys';

	const object = {
		a_b: 1,
		a_c: {
			c_d: 1,
			c_e: {
				e_f: 1
			}
		}
	};

	camelcaseKeys(object, {
		deep: true,
		stopPaths: [
			'a_c.c_e'
		]
	}),
	// {
	// 	aB: 1,
	// 	aC: {
	// 		cD: 1,
	// 		cE: {
	// 			e_f: 1
	// 		}
	// 	}
	// }
	```
	*/
  readonly stopPaths?: readonly string[];
};

const has = (array: Array<string | RegExp>, key: string) =>
  array.some((element) => {
    if (typeof element === "string") {
      return element === key;
    }

    element.lastIndex = 0;

    return element.test(key);
  });

const cache = new QuickLru({ maxSize: 100_000 });

// Reproduces behavior from `map-obj`.
const isObject = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  !(value instanceof RegExp) &&
  !(value instanceof Error) &&
  !(value instanceof Date);

const transform = (input: any, options: Options = {}): any => {
  if (!isObject(input)) {
    return input;
  }

  const {
    exclude,
    pascalCase = false,
    stopPaths,
    deep = false,
    preserveConsecutiveUppercase = false,
  } = options;

  const stopPathsSet = new Set(stopPaths);

  const makeMapper =
    (parentPath?: string) =>
    (key: string, value: any): any => {
      if (deep && isObject(value)) {
        const path = parentPath === undefined ? key : `${parentPath}.${key}`;

        if (!stopPathsSet.has(path)) {
          value = mapObject(value, makeMapper(path) as any);
        }
      }

      if (!(exclude && has(exclude as any, key))) {
        const cacheKey = pascalCase ? `${key}_` : key;

        if (cache.has(cacheKey)) {
          key = cache.get(cacheKey) as string;
        } else {
          const returnValue = camelCase(key, {
            pascalCase,
            locale: false,
            preserveConsecutiveUppercase,
          });

          if (key.length < 100) {
            // Prevent abuse
            cache.set(cacheKey, returnValue);
          }

          key = returnValue;
        }
      }

      return [key, value];
    };

  return mapObject(input, makeMapper(undefined) as any);
};

/**
Convert object keys to camel case using [`camelcase`](https://github.com/sindresorhus/camelcase).

@param input - Object or array of objects to camel-case.

@example
```
import camelcaseKeys from 'camelcase-keys';

// Convert an object
camelcaseKeys({'foo-bar': true});
//=> {fooBar: true}

// Convert an array of objects
camelcaseKeys([{'foo-bar': true}, {'bar-foo': false}]);
//=> [{fooBar: true}, {barFoo: false}]
```

@example
```
import {parseArgs} from 'node:util';
import camelcaseKeys from 'camelcase-keys';

const commandLineArguments = parseArgs();
//=> {_: [], 'foo-bar': true}

camelcaseKeys(commandLineArguments);
//=> {_: [], fooBar: true}
```
*/
export default function camelcaseKeys<
  T extends Record<string, unknown> | ReadonlyArray<Record<string, unknown>>,
  OptionsType extends Options = Options,
>(
  input: T,
  options?: OptionsType
): CamelCaseKeys<
  T,
  WithDefault<
    "deep" extends keyof OptionsType ? OptionsType["deep"] : undefined,
    false
  >,
  WithDefault<
    "pascalCase" extends keyof OptionsType
      ? OptionsType["pascalCase"]
      : undefined,
    false
  >,
  WithDefault<
    "preserveConsecutiveUppercase" extends keyof OptionsType
      ? OptionsType["preserveConsecutiveUppercase"]
      : undefined,
    false
  >,
  WithDefault<
    "exclude" extends keyof OptionsType ? OptionsType["exclude"] : undefined,
    EmptyTuple
  >,
  WithDefault<
    "stopPaths" extends keyof OptionsType
      ? OptionsType["stopPaths"]
      : undefined,
    EmptyTuple
  >
> {
  if (Array.isArray(input)) {
    return Object.keys(input).map((key) =>
      transform(input[key as unknown as number], options)
    ) as any;
  }

  return transform(input, options);
}
