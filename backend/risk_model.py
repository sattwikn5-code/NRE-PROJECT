"""CNN feature hook + Random Forest risk score R in [0, 1]."""
import os
import numpy as np

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "risk_rf.joblib")
# CNN(3) + weather, traffic, accidents(3) + width, surface, slope(3)
N_FEATURES = 9


def cnn_features(image_path=None):
    """Returns [pothole, surface_damage, roughness], each 0-1.
    Plug a trained CNN here (e.g. torch model). Stub returns zeros with no image."""
    return [0.0, 0.0, 0.0]


def _train_demo_model():
    """Synthetic training data so the API runs out of the box.
    Replace with real historical data + labels."""
    from sklearn.ensemble import RandomForestRegressor
    rng = np.random.default_rng(0)
    X = rng.random((2000, N_FEATURES))
    y = np.clip(0.3*X[:, 0] + 0.2*X[:, 1] + 0.1*X[:, 2] + 0.15*X[:, 3]
                + 0.1*X[:, 4] + 0.1*X[:, 5] - 0.05*X[:, 6] + 0.05*X[:, 8], 0, 1)
    return RandomForestRegressor(n_estimators=50, max_depth=8, n_jobs=-1, random_state=0).fit(X, y)


def load_model():
    import joblib
    if os.path.exists(MODEL_PATH):
        try:
            return joblib.load(MODEL_PATH)
        except Exception:
            pass   # e.g. saved with another scikit-learn version -> retrain below
    model = _train_demo_model()
    joblib.dump(model, MODEL_PATH)
    return model


def predict_risk(model, feature_rows):
    """Batch predict for all edges in ONE call (much faster than one-by-one)."""
    return np.clip(model.predict(np.asarray(feature_rows)), 0, 1).tolist()
