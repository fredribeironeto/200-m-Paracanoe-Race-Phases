import numpy as np
import pandas as pd
import statsmodels.api as sm
import pwlf
import io
from fastapi import UploadFile

def load_data(file_content: bytes, filename: str):
    if filename.lower().endswith('.csv'):
        return load_csv(file_content)
    
    try:
        data = pd.read_excel(io.BytesIO(file_content))
    except Exception as e:
        return None, f"Error reading Excel file: {str(e)}"

    # Check for alternate column names
    if 'Odometer' not in data.columns or 'Velocity' not in data.columns:
        if 'Distance' in data.columns and 'Speed' in data.columns:
            data.rename(columns={'Distance': 'Odometer', 'Speed': 'Velocity'}, inplace=True)
        elif 'Time' in data.columns and 'Speed' in data.columns:
            data.rename(columns={'Time': 'Odometer', 'Speed': 'Velocity'}, inplace=True)
        else:
            # If it's a raw export with different names
            possible_dist = ['Odometer', 'Distances (m)', 'km', 'Distance', 'dist', 'Dist', 'Distancia']
            possible_vel = ['Velocity', 'Speed (km/h)', 'kph', 'Speed', 'vel', 'Vel', 'Velocidade']
            
            dist_col = next((c for c in possible_dist if c in data.columns), None)
            vel_col = next((c for c in possible_vel if c in data.columns), None)
            
            if dist_col and vel_col:
                data.rename(columns={dist_col: 'Odometer', vel_col: 'Velocity'}, inplace=True)
            else:
                return None, "Invalid column names provided. Make sure to have 'Odometer' and 'Velocity'."
    
    data['Odometer'] = pd.to_numeric(data['Odometer'], errors='coerce')
    data['Velocity'] = pd.to_numeric(data['Velocity'], errors='coerce')
    
    # Unit conversion heuristics
    if data['Velocity'].max() > 20: 
        data['Velocity'] = data['Velocity'] / 3.6
    if data['Odometer'].max() < 5:
        data['Odometer'] = data['Odometer'] * 1000
        
    return data, None

def load_csv(file_content: bytes):
    try:
        # Decode content
        try:
            content_str = file_content.decode('utf-8')
        except UnicodeDecodeError:
            content_str = file_content.decode('latin-1')
            
        lines = content_str.splitlines()
        if not lines:
            return None, "Empty CSV file."

        # Detect delimiter and decimal
        # Heuristic: count occurrences in first few lines
        header_sample = "\n".join(lines[:5])
        if header_sample.count(';') > header_sample.count(','):
            delimiter = ';'
            decimal = ',' if ',' in header_sample else '.'
        else:
            delimiter = ','
            decimal = '.'

        # Detect format
        is_polar = any("Sample rate" in line for line in lines[:10])
        is_garmin = any("secs" in line and "kph" in line for line in lines[:2])
        
        if is_polar:
            # Find the header line for the actual data
            header_idx = -1
            for i, line in enumerate(lines):
                if "Sample rate" in line:
                    header_idx = i
                    break
            
            if header_idx == -1:
                return None, "Could not find Polar data header."
                
            df = pd.read_csv(io.StringIO("\n".join(lines[header_idx:])), sep=delimiter, decimal=decimal)
            
            # Map columns
            if 'Distances (m)' in df.columns and 'Speed (km/h)' in df.columns:
                df.rename(columns={'Distances (m)': 'Odometer', 'Speed (km/h)': 'Velocity'}, inplace=True)
                df['Velocity'] = pd.to_numeric(df['Velocity'], errors='coerce') / 3.6
            elif 'Odometer' in df.columns and 'Velocity' in df.columns:
                pass
            else:
                possible_dist = ['Odometer', 'Distances (m)', 'km', 'Distance', 'dist', 'Dist', 'Distancia']
                possible_vel = ['Velocity', 'Speed (km/h)', 'kph', 'Speed', 'vel', 'Vel', 'Velocidade']
                dist_col = next((c for c in possible_dist if c in df.columns), None)
                vel_col = next((c for c in possible_vel if c in df.columns), None)
                if dist_col and vel_col:
                    df.rename(columns={dist_col: 'Odometer', vel_col: 'Velocity'}, inplace=True)
                    if df['Velocity'].max() > 20: 
                        df['Velocity'] = df['Velocity'] / 3.6
                    if df['Odometer'].max() < 5:
                        df['Odometer'] = df['Odometer'] * 1000
            
            df['Odometer'] = pd.to_numeric(df['Odometer'], errors='coerce')
            df['Velocity'] = pd.to_numeric(df['Velocity'], errors='coerce')
            
        elif is_garmin:
            df = pd.read_csv(io.StringIO(content_str), sep=delimiter, decimal=decimal)
            # Standardize columns
            df.rename(columns={'km': 'Odometer', 'kph': 'Velocity'}, inplace=True)
            # km to m
            df['Odometer'] = pd.to_numeric(df['Odometer'], errors='coerce') * 1000
            # kph to m/s
            df['Velocity'] = pd.to_numeric(df['Velocity'], errors='coerce') / 3.6
        else:
            # Generic CSV
            df = pd.read_csv(io.StringIO(content_str), sep=delimiter, decimal=decimal)
            
            # Try to identify columns
            possible_dist = ['Odometer', 'Distances (m)', 'km', 'Distance', 'dist', 'Dist', 'Distancia']
            possible_vel = ['Velocity', 'Speed (km/h)', 'kph', 'Speed', 'vel', 'Vel', 'Velocidade']
            
            dist_col = next((c for c in possible_dist if c in df.columns), None)
            vel_col = next((c for c in possible_vel if c in df.columns), None)
            
            if dist_col and vel_col:
                df.rename(columns={dist_col: 'Odometer', vel_col: 'Velocity'}, inplace=True)
                df['Velocity'] = pd.to_numeric(df['Velocity'], errors='coerce')
                df['Odometer'] = pd.to_numeric(df['Odometer'], errors='coerce')
                
                # Unit conversion heuristics
                if df['Velocity'].max() > 20: 
                    df['Velocity'] = df['Velocity'] / 3.6
                if df['Odometer'].max() < 5:
                    df['Odometer'] = df['Odometer'] * 1000
        
        return filter_200m_race(df)
        
    except Exception as e:
        return None, f"Error reading CSV file: {str(e)}"

def load_raw_csv(file_content: bytes):
    try:
        # Decode content
        try:
            content_str = file_content.decode('utf-8')
        except UnicodeDecodeError:
            content_str = file_content.decode('latin-1')
            
        lines = content_str.splitlines()
        if not lines:
            return None, "Empty CSV file."

        # Detect delimiter and decimal
        header_sample = "\n".join(lines[:5])
        if header_sample.count(';') > header_sample.count(','):
            delimiter = ';'
            decimal = ',' if ',' in header_sample else '.'
        else:
            delimiter = ','
            decimal = '.'

        # Detect format
        is_polar = any("Sample rate" in line for line in lines[:10])
        is_garmin = any("secs" in line and "kph" in line for line in lines[:2])
        
        if is_polar:
            header_idx = -1
            for i, line in enumerate(lines):
                if "Sample rate" in line:
                    header_idx = i
                    break
            if header_idx == -1:
                return None, "Could not find Polar data header."
            df = pd.read_csv(io.StringIO("\n".join(lines[header_idx:])), sep=delimiter, decimal=decimal)
            
            # Map columns
            if 'Distances (m)' in df.columns and 'Speed (km/h)' in df.columns:
                df.rename(columns={'Distances (m)': 'Odometer', 'Speed (km/h)': 'Velocity'}, inplace=True)
                df['Velocity'] = pd.to_numeric(df['Velocity'], errors='coerce') / 3.6
            elif 'Odometer' in df.columns and 'Velocity' in df.columns:
                pass
            else:
                possible_dist = ['Odometer', 'Distances (m)', 'km', 'Distance', 'dist', 'Dist', 'Distancia']
                possible_vel = ['Velocity', 'Speed (km/h)', 'kph', 'Speed', 'vel', 'Vel', 'Velocidade']
                dist_col = next((c for c in possible_dist if c in df.columns), None)
                vel_col = next((c for c in possible_vel if c in df.columns), None)
                if dist_col and vel_col:
                    df.rename(columns={dist_col: 'Odometer', vel_col: 'Velocity'}, inplace=True)
                    if df['Velocity'].max() > 20: 
                        df['Velocity'] = df['Velocity'] / 3.6
                    if df['Odometer'].max() < 5:
                        df['Odometer'] = df['Odometer'] * 1000
            
            df['Odometer'] = pd.to_numeric(df['Odometer'], errors='coerce')
            df['Velocity'] = pd.to_numeric(df['Velocity'], errors='coerce')
        elif is_garmin:
            df = pd.read_csv(io.StringIO(content_str), sep=delimiter, decimal=decimal)
            df.rename(columns={'km': 'Odometer', 'kph': 'Velocity'}, inplace=True)
            df['Odometer'] = pd.to_numeric(df['Odometer'], errors='coerce') * 1000
            df['Velocity'] = pd.to_numeric(df['Velocity'], errors='coerce') / 3.6
        else:
            df = pd.read_csv(io.StringIO(content_str), sep=delimiter, decimal=decimal)
            possible_dist = ['Odometer', 'Distances (m)', 'km', 'Distance', 'dist', 'Dist', 'Distancia']
            possible_vel = ['Velocity', 'Speed (km/h)', 'kph', 'Speed', 'vel', 'Vel', 'Velocidade']
            dist_col = next((c for c in possible_dist if c in df.columns), None)
            vel_col = next((c for c in possible_vel if c in df.columns), None)
            if dist_col and vel_col:
                df.rename(columns={dist_col: 'Odometer', vel_col: 'Velocity'}, inplace=True)
                df['Velocity'] = pd.to_numeric(df['Velocity'], errors='coerce')
                df['Odometer'] = pd.to_numeric(df['Odometer'], errors='coerce')
                if df['Velocity'].max() > 20: 
                    df['Velocity'] = df['Velocity'] / 3.6
                if df['Odometer'].max() < 5:
                    df['Odometer'] = df['Odometer'] * 1000
        
        df = df.dropna(subset=['Velocity', 'Odometer']).reset_index(drop=True)
        return df, None
    except Exception as e:
        return None, f"Error reading raw CSV: {str(e)}"

def filter_200m_race(df, manual_start=None, manual_end=None):
    """
    Automatically detect the 200m race segment from raw data, 
    or use manual start/end distances if provided.
    """
    if 'Velocity' not in df.columns or 'Odometer' not in df.columns:
        return None, "CSV must contain Velocity and Odometer columns."
    
    # Drop rows with NaN in critical columns
    df = df.dropna(subset=['Velocity', 'Odometer']).reset_index(drop=True)
    
    # Clean GPS speed outliers (> 6.5 m/s)
    df = df[df['Velocity'] <= 6.5].reset_index(drop=True)
    
    if len(df) < 5:
        return None, "Not enough data in CSV."

    # If the file is already trimmed to a single sprint segment (total distance < 260m),
    # bypass start detection to preserve the whole file.
    if manual_start is None and manual_end is None:
        total_dist_raw = df['Odometer'].max() - df['Odometer'].min()
        if total_dist_raw < 260.0:
            # Refined bypass check:
            # Only bypass start detection if total distance is < 260m AND the first 6 seconds show a fast start
            # (i.e. mean velocity of the first 6 seconds is >= 1.5 m/s).
            # If the first 6 seconds show a slow start (mean velocity < 1.5 m/s), do NOT bypass, because
            # the athlete was waiting/paddling slowly, which will inflate the total time.
            first_6_mean_vel = df['Velocity'].head(6).mean() if len(df) >= 6 else df['Velocity'].mean()
            if first_6_mean_vel >= 1.5:
                df_race = df.copy()
                start_dist_real = df_race.iloc[0]['Odometer']
                df_race['Odometer'] = df_race['Odometer'] - start_dist_real
                return df_race.reset_index(drop=True), None

    if manual_start is not None:
        # Find index closest to manual_start
        start_idx = (df['Odometer'] - manual_start).abs().idxmin()
    else:
        # Apply smoothing to Velocity for peak/start detection
        # Use a 5-point rolling average to be robust against GPS jitter
        df['Vel_Smooth'] = df['Velocity'].rolling(window=5, center=True).mean().fillna(df['Velocity'])

        # 1. Find the peak velocity (using smoothed data)
        peak_idx = df['Vel_Smooth'].idxmax()
        
        # 2. Backtrack from the peak to find the start of the sprint
        curr = peak_idx
        while curr > 0:
            if df.loc[curr, 'Vel_Smooth'] < 1.5:
                break
            curr -= 1
        start_idx = curr
        
    # Extract data from start_idx
    df_race = df.iloc[start_idx:].copy()
    
    # Reset Odometer to start at 0 (temporarily for calculation)
    start_dist_real = df_race.iloc[0]['Odometer']
    df_race['Odometer_Relative'] = df_race['Odometer'] - start_dist_real
    
    if manual_end is not None:
        # Find index closest to manual_end
        # manual_end is an absolute odometer value
        end_idx_in_race = (df_race['Odometer'] - manual_end).abs().idxmin()
        df_race = df_race.loc[:end_idx_in_race].copy()
    else:
        # For files under 260m raw, if we ran start trimmer, keep all remaining data
        total_dist_raw = df['Odometer'].max() - df['Odometer'].min()
        if total_dist_raw < 260.0:
            pass
        else:
            # 4. Take data until exactly 200m (or first point past it)
            end_indices = df_race.index[df_race['Odometer_Relative'] >= 200.0].tolist()
            if end_indices:
                df_race = df_race.loc[:end_indices[0]].copy()
    
    # Use Odometer_Relative as the final Odometer for analysis
    df_race['Odometer'] = df_race['Odometer_Relative']
    cols_to_drop = ['Odometer_Relative']
    if 'Vel_Smooth' in df_race.columns:
        cols_to_drop.append('Vel_Smooth')
        
    return df_race.drop(columns=cols_to_drop).reset_index(drop=True), None

def preprocess_data(data):
    x = data['Odometer'].values
    y = data['Velocity'].values
    
    # Now interpolate to 200 points for the analysis pipeline
    x_new = np.linspace(x[0], x[-1], 200)
    y_new = np.interp(x_new, x, y)
    return x_new, y_new

def calculate_acceleration(x_new, y_new):
    acc = np.diff(y_new, prepend=y_new[0]) / (x_new[1] - x_new[0])
    acc_smooth = sm.nonparametric.lowess(acc, x_new, is_sorted=True, return_sorted=False, frac=0.2)
    return acc, acc_smooth

def find_acceleration_phase_end(acc_smooth, threshold=0.005):
    for pos_zc in range(len(acc_smooth)):
        if acc_smooth[pos_zc] < threshold:
            return pos_zc
    return len(acc_smooth) - 1

def piecewise_linear_fit(x, y, num_segments, pos_zc):
    model = pwlf.PiecewiseLinFit(x, y)
    breaks = np.linspace(x[0], x[-1], num_segments + 1)
    breaks[1] = x[pos_zc]  # Setting the first breakpoint as the position of the zero crossing
    model.fit_with_breaks(breaks)
    return model

def calculate_r_squared(y, y_fit):
    ss_res = np.sum((y - y_fit) ** 2)
    ss_tot = np.sum((y - np.mean(y)) ** 2)
    r_squared = 1 - (ss_res / ss_tot)
    return r_squared

def calculate_segment_statistics(x_new, y_new, breaks):
    statistics = []
    for i in range(len(breaks) - 1):
        start = int(np.argmin(np.abs(x_new - breaks[i])))
        end = int(np.argmin(np.abs(x_new - breaks[i + 1])))
        if end >= len(x_new):
            end = len(x_new) - 1
            
        if end <= start:
            continue
            
        distance = x_new[end] - x_new[start]
        
        # Use start:end slicing to match Race Phases 2.py exactly
        segment_y = y_new[start:end]
        if len(segment_y) == 0:
            segment_y = y_new[start:end+1]
            
        mean_velocity = np.mean(segment_y)
        time = distance / mean_velocity if mean_velocity > 0 else 0
        
        min_velocity = np.min(segment_y)
        max_velocity = np.max(segment_y)
        range_abs = max_velocity - min_velocity
        range_rel = (range_abs / mean_velocity) * 100 if mean_velocity > 0 else 0
        coefficient_variation = (np.std(segment_y) / mean_velocity) * 100 if mean_velocity > 0 else 0
        
        # Slicing uses y_new[end] and y_new[start] for segment inclination as in Race Phases 2.py
        segment_inclination_abs = (y_new[end] - y_new[start]) / distance if distance > 0 else 0
        segment_inclination_rel = (segment_inclination_abs / mean_velocity) * 100 if mean_velocity > 0 else 0

        statistics.append({
            "Phase": "Acceleration Phase" if i == 0 else f"Phase {i + 1}",
            "Dist (m)": round(distance, 1),
            "Time (s)": round(time, 1),
            "Mean Vel": round(mean_velocity, 2),
            "Min Vel": round(min_velocity, 2),
            "Max Vel": round(max_velocity, 2),
            "Range (Abs)": round(range_abs, 2),
            "Range (%)": round(range_rel, 1),
            "Var Coef (%)": round(coefficient_variation, 1),
            "Incl (Abs)": round(segment_inclination_abs, 2),
            "Incl (%)": round(segment_inclination_rel, 1)
        })

    return statistics

def analyze_race(file_content: bytes, filename: str, manual_bp1: float = None, manual_start: float = None, manual_end: float = None, bypass_trimming: bool = False):
    # Determine if trimmer should be bypassed
    is_excel = filename.lower().endswith(('.xlsx', '.xls'))
    should_bypass = bypass_trimming or (is_excel and manual_start is None and manual_end is None)

    if filename.lower().endswith('.csv'):
        raw_df, error = load_raw_csv(file_content)
        if error:
            return {"error": error}
        if should_bypass:
            df_race = raw_df.copy()
            start_dist_real = df_race.iloc[0]['Odometer']
            df_race['Odometer'] = df_race['Odometer'] - start_dist_real
            data = df_race.reset_index(drop=True)
        else:
            data, error = filter_200m_race(raw_df, manual_start, manual_end)
    else:
        raw_df, error = load_data(file_content, filename)
        if error:
            return {"error": error}
        if should_bypass:
            df_race = raw_df.copy()
            start_dist_real = df_race.iloc[0]['Odometer']
            df_race['Odometer'] = df_race['Odometer'] - start_dist_real
            data = df_race.reset_index(drop=True)
        else:
            data, error = filter_200m_race(raw_df, manual_start, manual_end)
        
    if error:
        return {"error": error}
        
    x_new, y_new = preprocess_data(data)
    acc, acc_smooth = calculate_acceleration(x_new, y_new)
    
    if manual_bp1 is not None and manual_bp1 > 0:
        pos_zc = int(np.argmin(np.abs(x_new - manual_bp1)))
    else:
        pos_zc = find_acceleration_phase_end(acc_smooth)
    
    total_dist = float(x_new[-1] - x_new[0])
    total_mean_vel = float(np.mean(y_new))
    total_time = total_dist / total_mean_vel if total_mean_vel > 0 else 0.0
    total_min_vel = float(np.min(y_new))
    total_max_vel = float(np.max(y_new))
    total_range_abs = total_max_vel - total_min_vel
    total_range_rel = (total_range_abs / total_mean_vel) * 100 if total_mean_vel > 0 else 0.0
    total_coef_var = (np.std(y_new) / total_mean_vel) * 100 if total_mean_vel > 0 else 0.0
    total_incl_abs = (y_new[-1] - y_new[0]) / total_dist if total_dist > 0 else 0.0
    total_incl_rel = (total_incl_abs / total_mean_vel) * 100 if total_mean_vel > 0 else 0.0

    results = {
        "filename": filename,
        "raw_data": {
            "x": x_new.tolist(),
            "y": y_new.tolist(),
            "acc": acc.tolist(),
            "acc_smooth": acc_smooth.tolist(),
            "pos_zc": pos_zc,
            "bp1_x": float(x_new[pos_zc]),
            "bp1_y": float(y_new[pos_zc]),
            "bp1_acc": float(acc_smooth[pos_zc])
        },
        "models": {},
        "total_statistics": {
            "Phase": "Total",
            "Dist (m)": round(total_dist, 1),
            "Time (s)": round(total_time, 1),
            "Mean Vel": round(total_mean_vel, 2),
            "Min Vel": round(total_min_vel, 2),
            "Max Vel": round(total_max_vel, 2),
            "Range (Abs)": round(total_range_abs, 2),
            "Range (%)": round(total_range_rel, 1),
            "Var Coef (%)": round(total_coef_var, 1),
            "Incl (Abs)": round(total_incl_abs, 2),
            "Incl (%)": round(total_incl_rel, 1)
        }
    }
    
    for num_segments in [2, 3, 4]:
        model = piecewise_linear_fit(x_new, y_new, num_segments, pos_zc)
        
        # Calculate fit
        x_fit = np.linspace(x_new[0], x_new[-1], len(x_new))
        y_fit = model.predict(x_fit)
        
        r_squared = calculate_r_squared(y_new, y_fit)
        
        segment_stats = calculate_segment_statistics(x_new, y_new, model.fit_breaks)
        
        # Breakpoints formatting (including final breakpoint for complete PyCharm alignment)
        breakpoints = []
        bp_indices = model.fit_breaks[1:]  # From 1: to include the last breakpoint representing the end of the race
        for i, bp in enumerate(bp_indices):
            bp_int = int(np.argmin(np.abs(x_new - bp)))
            if bp_int >= len(x_new):
                bp_int = len(x_new) - 1
                
            dist = float(x_new[bp_int])
            vel = float(y_new[bp_int])
            time_bp = dist / np.mean(y_new[:bp_int]) if bp_int > 0 and np.mean(y_new[:bp_int]) > 0 else 0
            
            label = f"BP{i+1}"
            if i == len(bp_indices) - 1:
                label = f"BP{num_segments} (End)"
                
            breakpoints.append({
                "label": label,
                "distance": round(dist, 1),
                "time": round(time_bp, 1),
                "velocity": round(vel, 2),
                "x_index": bp_int
            })
            
        results["models"][f"{num_segments}_phase"] = {
            "y_fit": y_fit.tolist(),
            "r_squared": float(r_squared),
            "statistics": segment_stats,
            "breakpoints": breakpoints
        }
        
    return results
