from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from analyzer import analyze_race
import typing
import os

app = FastAPI(title="Paracanoe Pacing Public API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Path to the frontend directory
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")

@app.post("/analyze")
async def upload_file(
    file: UploadFile = File(...),
    manual_bp1: typing.Optional[float] = Form(None),
    manual_start: typing.Optional[float] = Form(None),
    manual_end: typing.Optional[float] = Form(None),
    bypass_trimming: typing.Optional[bool] = Form(None)
):
    if not file.filename.lower().endswith(('.xlsx', '.xls', '.csv')):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload an Excel or CSV file.")
        
    try:
        content = await file.read()
        bypass = bool(bypass_trimming) if bypass_trimming is not None else False
        results = analyze_race(content, file.filename, manual_bp1, manual_start, manual_end, bypass_trimming=bypass)
        if "error" in results:
            raise HTTPException(status_code=400, detail=results["error"])
            
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/preview-csv")
async def preview_csv(file: UploadFile = File(...)):
    if not file.filename.lower().endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files can be previewed.")
        
    try:
        from analyzer import load_raw_csv, filter_200m_race
        content = await file.read()
        raw_df, error = load_raw_csv(content)
        if error:
            raise HTTPException(status_code=400, detail=error)
            
        filtered_df, _ = filter_200m_race(raw_df)
        
        peak_idx = raw_df['Velocity'].idxmax()
        curr = peak_idx
        while curr > 0 and raw_df.loc[curr, 'Velocity'] > 1.5:
            curr -= 1
        auto_start = float(raw_df.loc[curr, 'Odometer'])
        
        end_idx = raw_df.index[raw_df['Odometer'] >= auto_start + 200].tolist()
        auto_end = float(raw_df.loc[end_idx[0], 'Odometer']) if end_idx else float(raw_df['Odometer'].max())
        
        return {
            "filename": file.filename,
            "x": raw_df['Odometer'].tolist(),
            "y": raw_df['Velocity'].tolist(),
            "auto_start": auto_start,
            "auto_end": auto_end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Serve static files from the frontend directory
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    # Listening on port 8003 for the public version
    uvicorn.run("main:app", host="0.0.0.0", port=8003, reload=True)
