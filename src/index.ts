import mime from "mime-types";
import photon from "photon-cf-worker";

export interface Env {
	ENVIRONMENT: 'staging' | 'production';
	SEC_KEY: string;
	URL: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// the req path looks like media.kastelapp.com/u/<id>/<filename>?k=<key>&e=<expiry>&s=<signature>&h=<hash>
		// the hash is just a sha256 of the key, expiry
		// then a request for fetching the media itself is like
		// media.kastelapp.com/<id>/<filename>

		if (request.method === "PUT") {
			const url = new URL(request.url);

			const path = url.pathname.split("/");

			if (path[1] === "g") {
				return await this.uploadFile(request, env, ctx);
			} else if (path[1] === "u") {
				return await this.uploadIcon(request, env, ctx);
			}

			return new Response("", { status: 201 });

		} else if (request.method === "GET") { // example: http://127.0.0.1:8787/123/123 or http://127.0.0.1:8787/icon/123/<hash>
			// if its the icon one we want to run fetchIcon else fetchFile
			const url = new URL(request.url);

			const path = url.pathname.split("/");

			if (path[1] === "icon") {
				return await this.fetchIcon(request, env, ctx);
			} else {
				return await this.fetchFile(request, env, ctx);
			}
		}

		return new Response("Method not allowed", { status: 405 });
	},
	async uploadFile(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const key = url.searchParams.get("k");
		const expiry = url.searchParams.get("ex");
		const signature = url.searchParams.get("s");
		const id = url.pathname.split("/")[2];

		if (!key || !expiry || !signature || !id) {
			return new Response("Bad Request", { status: 400 });
		}

		if (!request.headers.get("Content-Type")?.includes("multipart/form-data")) {
			return new Response("Bad Request", { status: 400 });
		}

		const form = await request.formData();

		if (!form.has("file")) {
			return new Response("Bad Request", { status: 400 });
		}

		const presignedUrl = await fetch(`${env.URL}/guild/${id}/init?&k=${key}&ex=${expiry}&s=${signature}`, {
			method: "GET",
			headers: {
				"Authorization": `${env.SEC_KEY}`,
				"Content-Type": "application/json"
			}
		});

		const Text = await presignedUrl.text();

		if (presignedUrl.status !== 200) {
			if (env.ENVIRONMENT === "staging") {
				return new Response(Text, { status: presignedUrl.status });
			} else {
				return new Response("Internal Server Error", { status: 500 });
			}
		}

		const { Url } = JSON.parse(Text);

		const upload = await fetch(Url, {
			method: "PUT",
			headers: {
				"Content-Length": request.headers.get("Content-Length") || "",
			},
			body: form.get("file")
		});

		if (upload.status !== 200) {
			if (env.ENVIRONMENT === "staging") {
				return new Response(await upload.text(), { status: upload.status });
			} else {
				return new Response("Internal Server Error", { status: 500 });
			}
		}

		return new Response("", { status: 201 });
	},
	async uploadIcon(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const key = url.searchParams.get("k");
		const expiry = url.searchParams.get("ex");
		const signature = url.searchParams.get("s");
		const id = url.pathname.split("/")[2];

		if (!key || !expiry || !signature || !id) {
			return new Response("Bad Request", { status: 400 });
		}

		if (!request.headers.get("Content-Type")?.includes("multipart/form-data")) {
			return new Response("Bad Request", { status: 400 });
		}

		const form = await request.formData();

		if (!form.has("file")) {
			return new Response("Bad Request", { status: 400 });
		}

		const fileHash = await this.hashFile(form.get("file") as unknown as File);
		const fileType = this.getImageType(await (form.get("file") as unknown as File).arrayBuffer());

		if (!fileType) {
			if (env.ENVIRONMENT === "staging") {
				return new Response("Unsupported Media Type, allowed types are as following, png, jpg, jpeg, gif, webp", { status: 415 });
			} else {
				return new Response("Internal Server Error", { status: 500 });
			}
		}

		const presignedUrl = await fetch(`${env.URL}/icon/${id}/${fileHash}/init?&k=${key}&ex=${expiry}&s=${signature}&type=${fileType}`, {
			method: "GET",
			headers: {
				"Authorization": `${env.SEC_KEY}`,
				"Content-Type": "application/json"
			}
		});

		const Text = await presignedUrl.text();

		if (presignedUrl.status !== 200) {
			if (env.ENVIRONMENT === "staging") {
				return new Response(Text, { status: presignedUrl.status });
			} else {
				return new Response("Internal Server Error", { status: 500 });
			}
		}

		const { Url } = JSON.parse(Text);

		const upload = await fetch(Url, {
			method: "PUT",
			headers: {
				"Content-Length": request.headers.get("Content-Length") || "",
			},
			body: form.get("file")
		});

		if (upload.status !== 200) {
			if (env.ENVIRONMENT === "staging") {
				return new Response(await upload.text(), { status: upload.status });
			} else {
				return new Response("Internal Server Error", { status: 500 });
			}
		}

		return new Response(JSON.stringify({
			Hash: fileHash,
		}), { status: 201 });
	},
	async fetchFile(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const id = request.url.split("/")[3];
		const filename = request.url.split("/")[4];

		if (!id || !filename) {
			return new Response("Bad Request", { status: 400 });
		}

		let presignedUrl = await fetch(`${env.URL}/guild/${id}/${filename}`, {
			method: "GET",
			headers: {
				"Authorization": `${env.SEC_KEY}`,
				"Content-Type": "application/json"
			}
		});

		if (presignedUrl.status === 209) { // 209 just means that the file pre-signed url was expired, but the file was still in cache when it shouldnt be
			presignedUrl = await fetch(`${env.URL}/guild/${id}/${filename}`, {
				method: "GET",
				headers: {
					"Authorization": `${env.SEC_KEY}`,
					"Content-Type": "application/json"
				}
			});
		}

		const Text = await presignedUrl.text();

		if (presignedUrl.status !== 200) {
			if (env.ENVIRONMENT === "staging") {
				return new Response(Text, { status: presignedUrl.status });
			} else {
				return new Response("Internal Server Error", { status: 500 });
			}
		}

		const { Url, Type } = JSON.parse(Text);

		const upload = await fetch(Url, { // this fetches from a aws s3 bucket presigned url
			method: "GET",
		});

		if (upload.status !== 200) {
			if (env.ENVIRONMENT === "staging") {
				return new Response(await upload.text(), { status: upload.status });
			} else {
				return new Response("Internal Server Error", { status: 500 });
			}
		}

		// Unless its a image, or video we want to have the user download the file
		const allowedImageFormats = ["png", "jpg", "jpeg", "gif", "webp"];
		const allowedVideoFormats = ["mp4", "webm", "ogg"];

		let extension = mime.extension(Type);

		extension ||= "txt";

		const isVideo = allowedVideoFormats.includes(extension);
		const isImage = allowedImageFormats.includes(extension);

		if (isVideo || isImage) {
			return new Response(await upload.arrayBuffer(), {
				headers: {
					"Content-Type": Type,
					"Content-Disposition": `inline; filename="${filename}"`,
				}
			});
		}

		return new Response(await upload.arrayBuffer(), {
			headers: {
				"Content-Type": Type,
				"Content-Disposition": `attachment; filename="${filename}"`,
			}
		});

	},
	async fetchIcon(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const id = request.url.split("/")[4];
		let hash = request.url.split("/")[5];

		// remove any query params
		const format = hash.split(".")[1].replace(/\?.*/g, "");

		hash = hash.split(".")[0];

		const url = new URL(request.url);

		const allowedFormatTypes = ["png", "jpg", "jpeg", "gif", "webp"];
		const size = url.searchParams.get("size");
		const width = url.searchParams.get("width");
		const height = url.searchParams.get("height");

		if (!id || !hash) {
			return new Response("Bad Request", { status: 400 });
		}

		if (!allowedFormatTypes.includes(format)) {
			return new Response("Bad Request", { status: 400 });
		}

		if (size && width && height) {
			return new Response("Bad Request", { status: 400 });
		}

		if (width && !height || height && !width) {
			return new Response("Bad Request", { status: 400 });
		}

		let presignedUrl = await fetch(`${env.URL}/icon/${id}/${hash}`, {
			method: "GET",
			headers: {
				"Authorization": `${env.SEC_KEY}`,
				"Content-Type": "application/json"
			}
		});

		if (presignedUrl.status === 209) { // 209 just means that the file pre-signed url was expired, but the file was still in cache when it shouldnt be
			presignedUrl = await fetch(`${env.URL}/icon/${id}/${hash}`, {
				method: "GET",
				headers: {
					"Authorization": `${env.SEC_KEY}`,
					"Content-Type": "application/json"
				}
			});
		}

		const Text = await presignedUrl.text();

		if (presignedUrl.status !== 200) {
			if (env.ENVIRONMENT === "staging") {
				return new Response(Text, { status: presignedUrl.status });
			} else {
				return new Response("Internal Server Error", { status: 500 });
			}
		}

		const { Url, Type } = JSON.parse(Text);

		const upload = await fetch(Url, { // this fetches from a aws s3 bucket presigned url
			method: "GET",
		});

		// Type should always be a image and we always want to display it inline

		if (upload.status !== 200) {
			if (env.ENVIRONMENT === "staging") {
				return new Response(await upload.text(), { status: upload.status });
			} else {
				return new Response("Internal Server Error", { status: 500 });
			}
		}

		const arrayBuffer = await upload.arrayBuffer();
		const ImageType = this.getImageType(arrayBuffer);

		if (!ImageType) {
			if (env.ENVIRONMENT === "staging") {
				return new Response("Unsupported Media Type, allowed types are as following, png, jpg, jpeg, gif, webp", { status: 415 });
			} else {
				return new Response("Internal Server Error", { status: 500 });
			}
		}

		if (size || width && height) {
			const imgBase64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

			let phtn_img = photon.PhotonImage.new_from_base64(imgBase64);

			const imgWidth = phtn_img.get_width();
			const imgHeight = phtn_img.get_height();

			let uwidth = Number(size ?? width);
			let uheight = Number(size ?? height);

			if (uwidth > imgWidth) {
				uwidth = imgWidth;
			}

			if (uheight > imgHeight) {
				uheight = imgHeight;
			}

			if (uwidth < 0 || uheight < 0) {
				uwidth = 32;
				uheight = 32;
			}

			let newImg = photon.resize(phtn_img, uwidth, uheight, 1);

			let output_base64 = newImg.get_base64();

			var output_data = output_base64.replace(/^data:image\/\w+;base64,/, '');

			return new Response(
				Buffer.from(output_data, 'base64'),
				{
					headers: {
						"Content-Type": "image/png",
						"Content-Disposition": `inline; filename="icon.${format}"`,
					}
				}
			);
		}

		if (ImageType === format) {
			return new Response(arrayBuffer, { // TODO: add support for resizing images and converting them to different formats
				headers: {
					"Content-Type": Type,
					"Content-Disposition": `inline; filename="icon.${format}"`,
				}
			});
		} else {
			const req = await fetch(`${env.URL}/convert`, {
				method: "POST",
				body: JSON.stringify({
					File: btoa(String.fromCharCode(...new Uint8Array(arrayBuffer))),
					To: format
				}),
				headers: {
					"Content-Type": "application/json",
					"Authorization": `${env.SEC_KEY}`,
				}
			});

			const { File } = await req.json() as { File: string }; // base64 encoded file

			const buffer = Uint8Array.from(atob(File), c => c.charCodeAt(0));
			const newType = this.getImageTypeFromUint8Array(buffer);

			return new Response(buffer, {
				headers: {
					"Content-Type": mime.lookup(newType ?? "png") || "image/png",
					"Content-Disposition": `inline; filename="icon.${format}"`,
				}
			});

		}
	},
	async hashFile(file: File) {
		const buffer = await file.arrayBuffer();
		const hash = await crypto.subtle.digest("SHA-256", buffer);
		const hashArray = Array.from(new Uint8Array(hash));
		const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

		return hashHex;
	},
	getImageType(arrayBuffer: ArrayBuffer) {
		const imageByteTypes = {
			png: [137, 80, 78, 71],
			jpg: [255, 216, 255],
			jpeg: [255, 216, 255],
			gif: [71, 73, 70, 56],
			webp: [82, 73, 70, 70],
		};

		const buffer = new Uint8Array(arrayBuffer).slice(0, 4);

		for (const [type, bytes] of Object.entries(imageByteTypes)) {
			if (bytes.every((value, index) => value === buffer[index])) {
				return type;
			}
		}

		return null;
	},
	getImageTypeFromUint8Array(buffer: Uint8Array) {
		const imageByteTypes = {
			png: [137, 80, 78, 71],
			jpg: [255, 216, 255],
			jpeg: [255, 216, 255],
			gif: [71, 73, 70, 56],
			webp: [82, 73, 70, 70],
		};

		for (const [type, bytes] of Object.entries(imageByteTypes)) {
			if (bytes.every((value, index) => value === buffer[index])) {
				return type;
			}
		}

		return null;
	}
};
