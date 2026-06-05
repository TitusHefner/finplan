import pandas as pd
from sklearn.linear_model import LinearRegression
import numpy as np

def forecast_expenses():
    # Dummy data, in real app load from DB
    data = pd.DataFrame({
        'month': [1,2,3,4,5,6],
        'expenses': [1000, 1100, 1050, 1200, 1150, 1300]
    })
    X = data[['month']]
    y = data['expenses']
    model = LinearRegression()
    model.fit(X, y)
    next_month = np.array([[7]])
    prediction = model.predict(next_month)
    return prediction[0]

def what_if_purchase(amount: float, category: str):
    # Simulate impact over 30 days
    impacts = []
    for day in range(1, 31):
        impact = amount * (1 + day * 0.01)  # example compounding
        impacts.append({"day": day, "impact": impact})
    return impacts