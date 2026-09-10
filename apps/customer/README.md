# Customer Composer QA Checklist

1. Text to Video
   - Select Text to Video.
   - Enter Unicode text, including Hindi, Marathi and Chinese.
   - Confirm no image uploader is shown.
   - Confirm generation request carries `mode: text_to_video` and no provider model from the UI.

2. Image to Video
   - Select Image to Video.
   - Upload JPG, PNG or WebP under 10 MB.
   - Confirm preview and filename render.
   - Confirm raw image URL input does not exist.
   - Confirm generation request uses the uploaded asset ID.

3. AI Director
   - Confirm mode is visible as Coming soon.
   - Confirm it cannot submit a generation request.

4. Safety/regression
   - Confirm credits display remains driven by `/api/v1/credits`.
   - Confirm successful creation still follows queued/processing/completed polling.
   - Confirm cancellation remains available for non-terminal jobs.
   - Confirm output access remains through the authenticated generation output route.
