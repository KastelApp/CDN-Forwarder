import mime from "mime-types";

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
			const key = url.searchParams.get("k");
			const expiry = url.searchParams.get("ex");
			const signature = url.searchParams.get("s");
			const id = url.pathname.split("/")[2];

			if (!request.headers.get("Content-Type")?.includes("multipart/form-data")) {
				return new Response("Bad Request (CT)", { status: 400 })
			}

			const form = await request.formData()

			if (!form.has("file")) {
				return new Response("Bad Request (NF)", { status: 400 })
			}

			const path = url.pathname.split("/")

			if (path[1] !== "u") {
				return new Response("Bad Request (NU)", { status: 400 })
			}

			const presignedUrl = await fetch(`${env.URL}/guild/${id}/init?&k=${key}&ex=${expiry}&s=${signature}`, {
				method: "GET",
				headers: {
					"Authorization": `${env.SEC_KEY}`,
					"Content-Type": "application/json"
				}
			});

			const Text = await presignedUrl.text()

			if (presignedUrl.status !== 200) {
				return new Response(Text, { status: presignedUrl.status })
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
				return new Response(await upload.text(), { status: upload.status })
			}

			return new Response("", { status: 201 })
			
		} else if (request.method === "GET") { // example: http://127.0.0.1:8787/123/123
			const id = request.url.split("/")[3];
			const filename = request.url.split("/")[4];

			const presignedUrl = await fetch(`${env.URL}/guild/${id}/${filename}`, {
				method: "GET",
				headers: {
					"Authorization": `${env.SEC_KEY}`,
					"Content-Type": "application/json"
				}
			});

			const Text = await presignedUrl.text()

			console.log(Text)

			if (presignedUrl.status !== 200) {
				return new Response(Text, { status: presignedUrl.status })
			}

			const { Url, Type } = JSON.parse(Text);

			const upload = await fetch(Url, { // this fetches from a aws s3 bucket presigned url
				method: "GET",
			});

			if (upload.status !== 200) {
				return new Response(await upload.text(), { status: upload.status })
			}

			// Unless its a image, or video we want to have the user download the file
			const allowedImageFormats = ["png", "jpg", "jpeg", "gif", "webp"];
			const allowedVideoFormats = ["mp4", "webm", "ogg"];

			let extension = mime.extension(Type) 

			extension ||= "txt";

			const isVideo = allowedVideoFormats.includes(extension);
			const isImage = allowedImageFormats.includes(extension);

			if (isVideo || isImage) {
				return new Response(await upload.arrayBuffer(), {
					headers: {
						"Content-Type": Type,
						"Content-Disposition": `inline; filename="${filename}"`,
					}
				})
			}

			return new Response(await upload.arrayBuffer(), {
				headers: {
					"Content-Type": Type,
					"Content-Disposition": `attachment; filename="${filename}"`,
				}
			})
		}

		return new Response("Method not allowed", { status: 405 })
	}
};
