declare module "bs58" {
	export function encode(source: Uint8Array | number[]): string;
	export function decode(value: string): Uint8Array;
	const _default: {
		encode: typeof encode;
		decode: typeof decode;
	};
	export default _default;
}
